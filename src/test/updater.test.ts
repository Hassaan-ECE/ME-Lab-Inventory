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
  downloadedInstallerPath?: string;
  error?: string;
  installerPid?: number;
  latestVersion?: string;
  status: string;
}

interface SharedUpdater {
  checkForUpdate: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<UpdateState>;
}

interface UpdaterModule {
  createSharedUpdater: (options: {
    currentVersion: string;
    downloadInstaller?: (options: {
      manifest: { installerPath: string; sha256: string; version: string };
      onProgress?: (progress: { phase: "copying" | "ready" | "verifying"; progress: number }) => void;
      userDataPath: string;
    }) => Promise<string | { mtimeMs: number; outputPath: string; sha256: string; size: number; version?: string }>;
    executablePath: string;
    launchInstaller?: (options: {
      installerPath: string;
    }) => Promise<{ installerPath: string; installerPid?: number }>;
    userDataPath: string;
  }) => SharedUpdater;
  launchVisibleInstaller: (options: {
    installerPath: string;
    spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => ReturnType<typeof fakeSpawnProcess>;
  }) => Promise<{ installerPath: string; installerPid?: number }>;
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

  it("checks for updates without auto-starting a download, then reuses one explicit download", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      notes: "Patch release",
      published_at: "2026-04-25T12:00:00-05:00",
      sha256: hashText("installer-content"),
      version: "0.9.6",
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
      currentVersion: "0.9.5",
      downloadInstaller,
      executablePath: process.execPath,
      userDataPath,
    });

    const available = await updater.checkForUpdate();
    expect(available.status).toBe("available");
    expect(available.latestVersion).toBe("0.9.6");

    await flushMicrotasks();
    expect(downloadInstaller).not.toHaveBeenCalled();

    const firstDownload = updater.downloadUpdate();
    const secondDownload = updater.downloadUpdate();
    expect(downloadInstaller).toHaveBeenCalledTimes(1);

    resolveDownload(installerPath);
    await expect(firstDownload).resolves.toMatchObject({ status: "ready" });
    await expect(secondDownload).resolves.toMatchObject({ status: "ready" });
  });

  it("downloads and verifies a newer shared installer with the worker", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      notes: "Patch release",
      published_at: "2026-04-25T12:00:00-05:00",
      sha256: hashText("installer-content"),
      version: "0.9.6",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
      executablePath: process.execPath,
      userDataPath,
    });

    const downloaded = await updater.downloadUpdate();
    expect(downloaded.status).toBe("ready");
    expect(fs.existsSync(path.join(userDataPath, "updates", "0.9.6", path.basename(installerPath)))).toBe(true);
  });

  it("rejects manifests without a SHA-256 checksum before downloading", async () => {
    writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      version: "0.9.6",
    });
    const downloadInstaller = vi.fn();

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
      downloadInstaller,
      executablePath: process.execPath,
      userDataPath,
    });

    const result = await updater.downloadUpdate();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/64-character SHA-256/i);
    expect(downloadInstaller).not.toHaveBeenCalled();
  });

  it.each(["abc", "g".repeat(64), "a".repeat(63), "a".repeat(65)])(
    "rejects invalid manifest checksum %s",
    async (sha256) => {
      writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
      writeManifest({
        installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
        sha256,
        version: "0.9.6",
      });

      const updater = updaterModule.createSharedUpdater({
        currentVersion: "0.9.5",
        executablePath: process.execPath,
        userDataPath,
      });

      const result = await updater.checkForUpdate();
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/64-character SHA-256/i);
    },
  );

  it("hashes an existing cached installer before reusing it", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("installer-content"),
      version: "0.9.6",
    });
    const cachedInstallerPath = path.join(userDataPath, "updates", "0.9.6", path.basename(installerPath));
    fs.mkdirSync(path.dirname(cachedInstallerPath), { recursive: true });
    fs.writeFileSync(cachedInstallerPath, "tampered-cached-content");

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
      executablePath: process.execPath,
      userDataPath,
    });

    const downloaded = await updater.downloadUpdate();
    expect(downloaded.status).toBe("ready");
    expect(fs.readFileSync(cachedInstallerPath, "utf8")).toBe("installer-content");
  });

  it("rejects installer paths outside the shared update root", async () => {
    writeManifest({
      installer_path: "..\\outside.exe",
      sha256: hashText("outside"),
      version: "0.9.6",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
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
    writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("different-content"),
      version: "0.9.6",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
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

  it("rejects install when the verified cached installer changes before handoff", async () => {
    writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("installer-content"),
      version: "0.9.6",
    });
    const launchInstaller = vi.fn().mockResolvedValue({
      installerPath: path.join(userDataPath, "updates", "0.9.6", "ME_Lab_Inventory_Setup.exe"),
      installerPid: 4321,
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
      executablePath: process.execPath,
      launchInstaller,
      userDataPath,
    });

    const downloaded = await updater.downloadUpdate();
    expect(downloaded.status).toBe("ready");
    expect(downloaded.downloadedInstallerPath).toBeTruthy();
    fs.appendFileSync(downloaded.downloadedInstallerPath!, "tampered");

    const installResult = await updater.installUpdate();
    expect(installResult.status).toBe("error");
    expect(installResult.error).toMatch(/changed after verification/i);
    expect(launchInstaller).not.toHaveBeenCalled();
  });

  it("launches the visible installer directly before reporting installing", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("installer-content"),
      version: "0.9.6",
    });
    const spawnProcess = vi.fn(fakeSpawnProcess);

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
      executablePath: "C:\\Users\\Syed.H.Shah\\AppData\\Local\\Programs\\ME Inventory\\ME Inventory.exe",
      launchInstaller: (options) => updaterModule.launchVisibleInstaller({ ...options, spawnProcess }),
      userDataPath,
    });

    expect((await updater.downloadUpdate()).status).toBe("ready");
    const installing = await updater.installUpdate();

    expect(installing.status).toBe("installing");
    expect(installing.installerPid).toBe(4321);
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    const [command, spawnArgs, spawnOptions] = spawnProcess.mock.calls[0] ?? [];
    expect(command).toBe(path.join(userDataPath, "updates", "0.9.6", path.basename(installerPath)));
    expect(spawnArgs).toEqual([]);
    expect(spawnOptions).toMatchObject({
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
  });

  it("reports an update error when the direct installer launch fails", async () => {
    writeSharedInstaller("releases/0.9.6/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.6/ME_Lab_Inventory_Setup.exe",
      sha256: hashText("installer-content"),
      version: "0.9.6",
    });
    const launchInstaller = vi.fn().mockRejectedValue(new Error("Installer launch was blocked."));

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.5",
      executablePath: process.execPath,
      launchInstaller,
      userDataPath,
    });

    expect((await updater.downloadUpdate()).status).toBe("ready");
    const installResult = await updater.installUpdate();

    expect(installResult.status).toBe("error");
    expect(installResult.error).toBe("Installer launch was blocked.");
  });

  it("does not use PowerShell helpers or quit the app from the update install path", () => {
    const mainSource = fs.readFileSync(path.resolve("electron/main.mjs"), "utf8");
    const updaterSource = fs.readFileSync(path.resolve("electron/updater.mjs"), "utf8");

    expect(mainSource).toContain('ipcMain.handle("inventory:update:install", () => getSharedUpdater().installUpdate());');
    expect(mainSource).not.toMatch(/inventory:update:install[\s\S]{0,200}app\.quit/);
    expect(updaterSource).not.toContain("powershell.exe");
    expect(updaterSource).not.toContain("install-update.ps1");
    expect(updaterSource).not.toContain("/S");
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

function fakeSpawnProcess(command: string, args: string[], options: Record<string, unknown>) {
  void command;
  void args;
  void options;

  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = 4321;
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
