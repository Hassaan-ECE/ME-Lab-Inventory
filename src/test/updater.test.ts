/* @vitest-environment node */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface UpdateState {
  available: boolean;
  currentVersion: string;
  error?: string;
  installLogPath?: string;
  latestVersion?: string;
  status: string;
}

interface SharedUpdater {
  checkForUpdate: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<UpdateState>;
}

interface UpdaterModule {
  buildInstallHelperScript: (options: {
    executablePath: string;
    installerPath: string;
    logPath: string;
    parentPid: number;
  }) => string;
  createSharedUpdater: (options: {
    currentVersion: string;
    downloadInstaller?: (options: {
      manifest: { installerPath: string; sha256: string; version: string };
      onProgress?: (progress: { phase: "copying" | "ready" | "verifying"; progress: number }) => void;
      userDataPath: string;
    }) => Promise<string>;
    executablePath: string;
    launchInstaller?: (options: {
      executablePath: string;
      installerPath: string;
      parentPid: number;
      userDataPath: string;
      version: string;
    }) => Promise<{ logPath: string; scriptPath: string }>;
    userDataPath: string;
  }) => SharedUpdater;
  launchInstallerAndRelaunch: (options: {
    executablePath: string;
    installerPath: string;
    parentPid: number;
    spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => ReturnType<typeof fakeSpawnProcess>;
    userDataPath: string;
    version: string;
  }) => Promise<{ logPath: string; scriptPath: string }>;
}

describe("shared updater", () => {
  let originalSharedRoot: string | undefined;
  let tempDir: string;
  let sharedRootPath: string;
  let userDataPath: string;
  let updaterModule: UpdaterModule;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "me-inventory-updater-"));
    sharedRootPath = path.join(tempDir, "shared-root");
    userDataPath = path.join(tempDir, "user-data");
    fs.mkdirSync(sharedRootPath, { recursive: true });
    fs.mkdirSync(userDataPath, { recursive: true });
    originalSharedRoot = process.env.ME_LAB_SHARED_ROOT;
    process.env.ME_LAB_SHARED_ROOT = sharedRootPath;
    updaterModule = (await import(pathToFileURL(path.resolve("electron/updater.mjs")).href)) as UpdaterModule;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSharedRoot == null) {
      delete process.env.ME_LAB_SHARED_ROOT;
    } else {
      process.env.ME_LAB_SHARED_ROOT = originalSharedRoot;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("auto-starts a background download for a newer shared installer", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.7/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.7/ME_Lab_Inventory_Setup.exe",
      notes: "Patch release",
      published_at: "2026-04-25T12:00:00-05:00",
      sha256: hashText("installer-content"),
      version: "0.9.7",
    });
    let resolveDownload: (installerPath: string) => void = () => undefined;
    const downloadInstaller = vi.fn(
      ({ onProgress }) =>
        new Promise<string>((resolve) => {
          resolveDownload = (nextInstallerPath) => {
            onProgress?.({ phase: "ready", progress: 1 });
            resolve(nextInstallerPath);
          };
        }),
    );

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.6",
      downloadInstaller,
      executablePath: process.execPath,
      userDataPath,
    });

    const available = await updater.checkForUpdate();
    expect(available.status).toBe("available");
    expect(available.latestVersion).toBe("0.9.7");

    await flushMicrotasks();
    expect(downloadInstaller).toHaveBeenCalledTimes(1);

    const firstDownload = updater.downloadUpdate();
    const secondDownload = updater.downloadUpdate();
    expect(downloadInstaller).toHaveBeenCalledTimes(1);

    resolveDownload(installerPath);
    await expect(firstDownload).resolves.toMatchObject({ status: "ready" });
    await expect(secondDownload).resolves.toMatchObject({ status: "ready" });
  });

  it("downloads and verifies a newer shared installer with the worker", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.7/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.7/ME_Lab_Inventory_Setup.exe",
      notes: "Patch release",
      published_at: "2026-04-25T12:00:00-05:00",
      sha256: hashText("installer-content"),
      version: "0.9.7",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.6",
      executablePath: process.execPath,
      userDataPath,
    });

    const downloaded = await updater.downloadUpdate();
    expect(downloaded.status).toBe("ready");
    expect(fs.existsSync(path.join(userDataPath, "updates", "0.9.7", path.basename(installerPath)))).toBe(true);
  });

  it("rejects installer paths outside the shared update root", async () => {
    writeManifest({
      installer_path: "..\\outside.exe",
      sha256: hashText("outside"),
      version: "0.9.7",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.6",
      executablePath: process.execPath,
      userDataPath,
    });

    const result = await updater.checkForUpdate();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/inside the shared update folder/i);

    const installResult = await updater.installUpdate();
    expect(installResult.status).toBe("error");
    expect(installResult.error).toMatch(/not been downloaded|no newer update/i);
  });

  it("rejects downloaded installers with a mismatched checksum", async () => {
    writeSharedInstaller("releases/0.9.7/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.7/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("different-content"),
      version: "0.9.7",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.6",
      executablePath: process.execPath,
      userDataPath,
    });

    const result = await updater.downloadUpdate();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/checksum/i);

    const installResult = await updater.installUpdate();
    expect(installResult.status).toBe("error");
    expect(installResult.error).toMatch(/not been downloaded/i);
  });

  it("launches a visible installer handoff before reporting installing", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.7/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.7/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("installer-content"),
      version: "0.9.7",
    });
    const spawnProcess = vi.fn(fakeSpawnProcess);

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.6",
      executablePath: "C:\\Users\\Syed.H.Shah\\AppData\\Local\\Programs\\ME Inventory\\ME Inventory.exe",
      launchInstaller: (options) => updaterModule.launchInstallerAndRelaunch({ ...options, spawnProcess }),
      userDataPath,
    });

    expect((await updater.downloadUpdate()).status).toBe("ready");
    const installing = await updater.installUpdate();

    expect(installing.status).toBe("installing");
    expect(installing.installLogPath).toContain("install-update.log");
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    const spawnArgs = (spawnProcess.mock.calls[0]?.[1] ?? []) as string[];
    const scriptPath = spawnArgs[spawnArgs.indexOf("-File") + 1];
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("Launching visible installer");
    expect(script).toContain("Start-Process -FilePath $installer -PassThru");
    expect(script).not.toContain("/S");
    expect(script).toContain(
      path.join(userDataPath, "updates", "0.9.7", path.basename(installerPath)).replaceAll("'", "''"),
    );
  });

  it("builds an install helper that waits for app shutdown and relaunches", () => {
    const script = updaterModule.buildInstallHelperScript({
      executablePath: "C:\\Programs\\ME Inventory\\ME Inventory.exe",
      installerPath: "C:\\Updates\\ME_Lab_Inventory_Setup.exe",
      logPath: "C:\\Users\\Syed\\AppData\\Roaming\\me-inventory\\updates\\0.9.7\\install-update.log",
      parentPid: 1234,
    });

    expect(script).toContain("Wait-Process -Id $parentPid");
    expect(script).toContain("Get-AppProcessCount");
    expect(script).toContain("Start-Process -FilePath $installer -PassThru");
    expect(script).toContain("Start-Process -FilePath $app");
    expect(script).not.toContain("SilentlyContinue'; $parentPid");
    expect(script).not.toContain("/S");
  });

  function writeSharedInstaller(relativePath: string, contents: string): string {
    const installerPath = path.join(sharedRootPath, relativePath);
    fs.mkdirSync(path.dirname(installerPath), { recursive: true });
    fs.writeFileSync(installerPath, contents);
    return installerPath;
  }

  function writeManifest(manifest: Record<string, string>): void {
    fs.writeFileSync(path.join(sharedRootPath, "current.json"), JSON.stringify(manifest, null, 2));
  }
});

function fakeSpawnProcess(..._args: unknown[]) {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  process.nextTick(() => child.emit("spawn"));
  return child;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
