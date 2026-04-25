import { spawn } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { resolveSharedRootPath } from "./inventory-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPDATE_MANIFEST_FILENAME = "current.json";
const DOWNLOAD_WORKER_PATH = resolveBundledWorkerPath(path.join(__dirname, "update-download-worker.mjs"));
const INSTALL_HELPER_FILENAME = "install-update.ps1";
const INSTALL_LOG_FILENAME = "install-update.log";

export function createSharedUpdater({
  currentVersion,
  executablePath,
  userDataPath,
  downloadInstaller = copyAndVerifyInstaller,
  launchInstaller = launchInstallerAndRelaunch,
} = {}) {
  let manifest = null;
  let downloadedInstallerPath = "";
  let downloadedInstaller = null;
  let downloadPromise = null;
  let state = buildBaseState("idle", currentVersion);
  const listeners = new Set();

  function emit(nextState) {
    state = { ...nextState };
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  }

  function clearDownloadedInstaller() {
    downloadedInstaller = null;
    downloadedInstallerPath = "";
  }

  async function checkForUpdate() {
    emit(buildBaseState("checking", currentVersion));

    try {
      const result = await readSharedUpdateManifest(currentVersion);
      manifest = result.manifest;
      if (!downloadedInstallerMatchesManifest(downloadedInstaller, manifest)) {
        clearDownloadedInstaller();
      }

      if (!result.updateAvailable) {
        return emit({
          ...buildBaseState("not-available", currentVersion),
          latestVersion: manifest?.version,
        });
      }

      return emit(buildAvailableState(currentVersion, manifest));
    } catch (error) {
      manifest = null;
      clearDownloadedInstaller();
      return emit(buildErrorState(currentVersion, error));
    }
  }

  async function startDownloadFromManifest() {
    if (downloadPromise) {
      return downloadPromise;
    }
    if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) {
      return state;
    }

    if (downloadedInstaller && (await isVerifiedInstallerStillCurrent(downloadedInstaller, manifest))) {
      downloadedInstallerPath = downloadedInstaller.path;
      return emit({
        ...buildAvailableState(currentVersion, manifest),
        downloadPhase: "ready",
        downloadProgress: 1,
        downloadedInstallerPath,
        status: "ready",
      });
    }
    clearDownloadedInstaller();

    downloadPromise = runDownloadFromManifest().finally(() => {
      downloadPromise = null;
    });
    return downloadPromise;
  }

  async function runDownloadFromManifest() {
    try {
      emit({
        ...buildAvailableState(currentVersion, manifest),
        downloadPhase: "copying",
        downloadProgress: 0,
        status: "downloading",
      });

      const downloaded = await downloadInstaller({
        currentVersion,
        manifest,
        onProgress: ({ phase, progress }) => {
          emit({
            ...buildAvailableState(currentVersion, manifest),
            downloadPhase: phase,
            downloadProgress: progress,
            status: "downloading",
          });
        },
        userDataPath,
      });
      downloadedInstaller = await normalizeDownloadedInstaller(downloaded, manifest);
      downloadedInstallerPath = downloadedInstaller.path;

      return emit({
        ...buildAvailableState(currentVersion, manifest),
        downloadPhase: "ready",
        downloadProgress: 1,
        downloadedInstallerPath,
        status: "ready",
      });
    } catch (error) {
      clearDownloadedInstaller();
      return emit(buildErrorState(currentVersion, error, manifest));
    }
  }

  return {
    getState: () => state,
    onStateChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    checkForUpdate,
    async downloadUpdate() {
      if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) {
        const checkedState = await checkForUpdate();
        if (!checkedState.available || !manifest) {
          return checkedState;
        }
      }

      return startDownloadFromManifest();
    },
    async installUpdate() {
      try {
        if (downloadPromise) {
          await downloadPromise;
        }
        if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) {
          throw new Error("No newer update is available to install.");
        }
        if (!downloadedInstaller || !downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
          throw new Error("The update installer has not been downloaded yet.");
        }
        if (!(await isVerifiedInstallerStillCurrent(downloadedInstaller, manifest))) {
          clearDownloadedInstaller();
          throw new Error("The downloaded update changed after verification. Please download it again.");
        }

        const handoff = await launchInstaller({
          executablePath,
          installerPath: downloadedInstaller.path,
          parentPid: process.pid,
          userDataPath,
          version: manifest.version,
        });

        return emit({
          ...buildAvailableState(currentVersion, manifest),
          downloadPhase: "ready",
          downloadProgress: 1,
          downloadedInstallerPath,
          installLogPath: handoff.logPath,
          status: "installing",
        });
      } catch (error) {
        return emit(buildErrorState(currentVersion, error, manifest));
      }
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

export async function copyAndVerifyInstaller({
  manifest,
  onProgress,
  userDataPath,
  workerPath = DOWNLOAD_WORKER_PATH,
}) {
  if (!fs.existsSync(manifest.installerPath)) {
    throw new Error("Update installer could not be found on the shared drive.");
  }

  const downloadDirectory = path.join(userDataPath, "updates", manifest.version);
  const outputPath = path.join(downloadDirectory, path.basename(manifest.installerPath));

  const downloaded = await runDownloadWorker({
    expectedHash: manifest.sha256,
    onProgress,
    outputPath,
    sourcePath: manifest.installerPath,
    workerPath,
  });

  return {
    ...downloaded,
    sha256: manifest.sha256,
    version: manifest.version,
  };
}

export async function launchInstallerAndRelaunch({
  executablePath,
  installerPath,
  parentPid,
  userDataPath,
  version,
  spawnProcess = spawn,
}) {
  const handoff = await writeInstallHelperScript({
    executablePath,
    installerPath,
    parentPid,
    userDataPath,
    version,
  });
  await spawnPowerShellHelper(handoff.scriptPath, spawnProcess);
  return handoff;
}

export async function writeInstallHelperScript({ executablePath, installerPath, parentPid, userDataPath, version }) {
  const helperDirectory = path.join(userDataPath, "updates", normalizeFileSegment(version) || "pending");
  const scriptPath = path.join(helperDirectory, INSTALL_HELPER_FILENAME);
  const logPath = path.join(helperDirectory, INSTALL_LOG_FILENAME);
  await fsp.mkdir(helperDirectory, { recursive: true });
  await fsp.writeFile(
    scriptPath,
    buildInstallHelperScript({ executablePath, installerPath, logPath, parentPid }),
    "utf8",
  );

  return { logPath, scriptPath };
}

export function buildInstallHelperScript({ executablePath, installerPath, logPath, parentPid }) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$parentPid = ${Number(parentPid)}`,
    `$installer = ${toPowerShellString(installerPath)}`,
    `$app = ${toPowerShellString(executablePath)}`,
    `$log = ${toPowerShellString(logPath)}`,
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null",
    "function Write-InstallLog { param([string]$Message) Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ' + $Message) }",
    "function Get-AppProcessCount { @((Get-Process -ErrorAction SilentlyContinue) | Where-Object { try { $_.Path -eq $app -and $_.Id -ne $PID } catch { $false } }).Count }",
    "try {",
    "  Write-InstallLog 'Helper started.'",
    "  Write-InstallLog ('Install requested by app process {0}.' -f $parentPid)",
    "  if (!(Test-Path -LiteralPath $installer)) { throw ('Installer missing: {0}' -f $installer) }",
    "  Write-InstallLog 'Launching visible installer.'",
    "  $installerProcess = Start-Process -FilePath $installer -PassThru",
    "  if ($null -eq $installerProcess) { throw 'Installer process did not start.' }",
    "  Write-InstallLog ('Installer started with PID {0}.' -f $installerProcess.Id)",
    "  Wait-Process -Id $installerProcess.Id -ErrorAction SilentlyContinue",
    "  Write-InstallLog 'Installer finished.'",
    "  Start-Sleep -Seconds 1",
    "  $appProcessCount = Get-AppProcessCount",
    "  if ($appProcessCount -eq 0 -and (Test-Path -LiteralPath $app)) {",
    "    Start-Process -FilePath $app",
    "    Write-InstallLog 'Relaunched app.'",
    "  } elseif ($appProcessCount -gt 0) {",
    "    Write-InstallLog 'App is already running; relaunch skipped.'",
    "  } else {",
    "    Write-InstallLog ('Installed app executable was not found for relaunch: {0}' -f $app)",
    "  }",
    "} catch {",
    "  Write-InstallLog ('ERROR: {0}' -f $_.Exception.Message)",
    "  exit 1",
    "}",
    "",
  ].join("\r\n");
}

function runDownloadWorker({ expectedHash, onProgress, outputPath, sourcePath, workerPath }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, {
      workerData: {
        expectedHash,
        outputPath,
        sourcePath,
      },
    });

    worker.on("message", (message) => {
      if (message?.type === "progress") {
        onProgress?.({
          phase: normalizeDownloadPhase(message.phase),
          progress: Math.max(0, Math.min(1, Number(message.progress) || 0)),
        });
        return;
      }
      if (message?.type === "done") {
        settled = true;
        resolve({
          mtimeMs: Number(message.mtimeMs) || 0,
          outputPath: String(message.outputPath ?? outputPath),
          reused: Boolean(message.reused),
          sha256: typeof message.sha256 === "string" ? message.sha256 : expectedHash,
          size: Number(message.size) || 0,
        });
        return;
      }
      if (message?.type === "error") {
        settled = true;
        reject(new Error(String(message.error || "Update download failed.")));
      }
    });
    worker.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    worker.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(code === 0 ? "Update download worker exited before finishing." : `Update download worker exited with code ${code}.`));
    });
  });
}

function spawnPowerShellHelper(scriptPath, spawnProcess) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;

    try {
      child = spawnProcess(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
    } catch (error) {
      reject(error);
      return;
    }

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve();
      }
    });
  });
}

function buildBaseState(status, currentVersion) {
  return {
    available: false,
    currentVersion,
    status,
  };
}

function buildAvailableState(currentVersion, currentManifest) {
  return {
    available: true,
    currentVersion,
    latestVersion: currentManifest.version,
    notes: currentManifest.notes,
    publishedAt: currentManifest.publishedAt,
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

function downloadedInstallerMatchesManifest(installer, currentManifest) {
  if (!installer || !currentManifest) {
    return false;
  }

  return installer.version === currentManifest.version && installer.sha256 === currentManifest.sha256;
}

async function isVerifiedInstallerStillCurrent(installer, currentManifest) {
  if (!downloadedInstallerMatchesManifest(installer, currentManifest)) {
    return false;
  }

  try {
    const stats = await fsp.stat(installer.path);
    return stats.size === installer.size && stats.mtimeMs === installer.mtimeMs;
  } catch {
    return false;
  }
}

async function normalizeDownloadedInstaller(downloaded, currentManifest) {
  const installerPath = typeof downloaded === "string" ? downloaded : String(downloaded?.outputPath ?? downloaded?.path ?? "");
  if (!installerPath) {
    throw new Error("Update download did not return an installer path.");
  }

  const stats = await fsp.stat(installerPath);
  return {
    mtimeMs: Number.isFinite(downloaded?.mtimeMs) ? downloaded.mtimeMs : stats.mtimeMs,
    path: installerPath,
    sha256: normalizeManifestText(downloaded?.sha256).toLowerCase() || currentManifest.sha256,
    size: Number.isFinite(downloaded?.size) ? downloaded.size : stats.size,
    version: normalizeManifestText(downloaded?.version) || currentManifest.version,
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

function parseVersion(value) {
  return String(value ?? "")
    .trim()
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
}

function normalizeDownloadPhase(value) {
  return ["copying", "ready", "verifying"].includes(value) ? value : "copying";
}

function resolveBundledWorkerPath(workerPath) {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!workerPath.includes(asarSegment)) {
    return workerPath;
  }

  const unpackedWorkerPath = workerPath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  return fs.existsSync(unpackedWorkerPath) ? unpackedWorkerPath : workerPath;
}

function normalizeFileSegment(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeManifestText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
