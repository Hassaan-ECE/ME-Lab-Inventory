import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";

import { resolveSharedRootPath } from "./inventory-runtime.mjs";

const UPDATE_MANIFEST_FILENAME = "current.json";
const INSTALLER_ARGUMENTS = ["/S"];

export function createSharedUpdater({ currentVersion, executablePath, userDataPath }) {
  let manifest = null;
  let downloadedInstallerPath = "";
  let state = buildBaseState("idle", currentVersion);
  const listeners = new Set();

  function emit(nextState) {
    state = { ...nextState };
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  }

  return {
    getState: () => state,
    onStateChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async checkForUpdate() {
      emit(buildBaseState("checking", currentVersion));

      try {
        const result = await readSharedUpdateManifest(currentVersion);
        manifest = result.manifest;
        downloadedInstallerPath = "";

        if (!result.updateAvailable) {
          return emit({
            ...buildBaseState("not-available", currentVersion),
            latestVersion: manifest?.version,
          });
        }

        return emit(buildAvailableState(currentVersion, manifest));
      } catch (error) {
        manifest = null;
        downloadedInstallerPath = "";
        return emit(buildErrorState(currentVersion, error));
      }
    },
    async downloadUpdate() {
      try {
        if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) {
          const checkedState = await this.checkForUpdate();
          if (!checkedState.available || !manifest) {
            return checkedState;
          }
        }

        emit({
          ...buildAvailableState(currentVersion, manifest),
          status: "downloading",
        });

        const installerPath = await copyAndVerifyInstaller({
          currentVersion,
          manifest,
          userDataPath,
        });
        downloadedInstallerPath = installerPath;

        return emit({
          ...buildAvailableState(currentVersion, manifest),
          downloadedInstallerPath,
          status: "ready",
        });
      } catch (error) {
        downloadedInstallerPath = "";
        return emit(buildErrorState(currentVersion, error, manifest));
      }
    },
    installUpdate() {
      if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
        throw new Error("The update installer has not been downloaded yet.");
      }

      launchInstallerAndRelaunch({
        executablePath,
        installerPath: downloadedInstallerPath,
        parentPid: process.pid,
      });
    },
  };
}

export async function readSharedUpdateManifest(currentVersion) {
  const sharedRootPath = resolveSharedRootPath();
  if (!sharedRootPath) {
    return { manifest: null, updateAvailable: false };
  }

  const manifestPath = path.join(sharedRootPath, UPDATE_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, updateAvailable: false };
  }

  const rawManifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  const manifest = normalizeManifest(rawManifest, manifestPath, sharedRootPath);

  return {
    manifest,
    updateAvailable: compareVersions(manifest.version, currentVersion) > 0,
  };
}

export function compareVersions(leftVersion, rightVersion) {
  const leftParts = parseVersion(leftVersion);
  const rightParts = parseVersion(rightVersion);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const left = leftParts[index] ?? 0;
    const right = rightParts[index] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }

  return 0;
}

export function resolveManifestInstallerPath(installerPath, sharedRootPath) {
  const candidatePath = path.isAbsolute(installerPath)
    ? path.resolve(installerPath)
    : path.resolve(sharedRootPath, installerPath);
  const relativePath = path.relative(sharedRootPath, candidatePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Update installer path must stay inside the shared update folder.");
  }

  return candidatePath;
}

export function launchInstallerAndRelaunch({ executablePath, installerPath, parentPid }) {
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$parentPid = ${Number(parentPid)}`,
    `$installer = ${toPowerShellString(installerPath)}`,
    `$app = ${toPowerShellString(executablePath)}`,
    "Wait-Process -Id $parentPid -ErrorAction SilentlyContinue",
    `$process = Start-Process -FilePath $installer -ArgumentList ${toPowerShellString(INSTALLER_ARGUMENTS.join(" "))} -PassThru`,
    "if ($process) { Wait-Process -Id $process.Id -ErrorAction SilentlyContinue }",
    "Start-Sleep -Seconds 1",
    "Start-Process -FilePath $app",
  ].join("; ");

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", command],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
}

function buildBaseState(status, currentVersion) {
  return {
    available: false,
    currentVersion,
    status,
  };
}

function buildAvailableState(currentVersion, manifest) {
  return {
    available: true,
    currentVersion,
    latestVersion: manifest.version,
    notes: manifest.notes,
    publishedAt: manifest.publishedAt,
    status: "available",
  };
}

function buildErrorState(currentVersion, error, currentManifest = null) {
  return {
    available: Boolean(currentManifest),
    currentVersion,
    error: error instanceof Error ? error.message : "Update check failed.",
    latestVersion: currentManifest?.version,
    notes: currentManifest?.notes,
    publishedAt: currentManifest?.publishedAt,
    status: "error",
  };
}

function normalizeManifest(rawManifest, manifestPath, sharedRootPath) {
  const version = normalizeManifestText(rawManifest?.version);
  const installerPath = normalizeManifestText(rawManifest?.installer_path);

  if (!version) {
    throw new Error("Update manifest is missing a version.");
  }
  if (!installerPath) {
    throw new Error("Update manifest is missing an installer path.");
  }

  return {
    installerPath: resolveManifestInstallerPath(installerPath, sharedRootPath),
    manifestPath,
    notes: normalizeManifestText(rawManifest?.notes),
    publishedAt: normalizeManifestText(rawManifest?.published_at),
    sha256: normalizeManifestText(rawManifest?.sha256).toLowerCase(),
    version,
  };
}

async function copyAndVerifyInstaller({ currentVersion, manifest, userDataPath }) {
  if (!fs.existsSync(manifest.installerPath)) {
    throw new Error("Update installer could not be found on the shared drive.");
  }

  const downloadDirectory = path.join(userDataPath, "updates", manifest.version);
  const outputPath = path.join(downloadDirectory, path.basename(manifest.installerPath));
  await fsp.mkdir(downloadDirectory, { recursive: true });

  if (fs.existsSync(outputPath) && (await installerMatchesExpectedHash(outputPath, manifest.sha256))) {
    return outputPath;
  }

  await fsp.copyFile(manifest.installerPath, outputPath);
  if (!(await installerMatchesExpectedHash(outputPath, manifest.sha256))) {
    await fsp.rm(outputPath, { force: true });
    throw new Error(`Downloaded update ${manifest.version} did not match the expected checksum for ${currentVersion}.`);
  }

  return outputPath;
}

async function installerMatchesExpectedHash(installerPath, expectedHash) {
  if (!expectedHash) {
    return true;
  }

  return (await hashFile(installerPath)) === expectedHash;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseVersion(value) {
  return String(value ?? "")
    .trim()
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
}

function normalizeManifestText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
