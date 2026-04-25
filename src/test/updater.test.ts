/* @vitest-environment node */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface UpdateState {
  available: boolean;
  currentVersion: string;
  error?: string;
  latestVersion?: string;
  status: string;
}

interface SharedUpdater {
  checkForUpdate: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdate: () => void;
}

interface UpdaterModule {
  createSharedUpdater: (options: {
    currentVersion: string;
    executablePath: string;
    userDataPath: string;
  }) => SharedUpdater;
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
    if (originalSharedRoot == null) {
      delete process.env.ME_LAB_SHARED_ROOT;
    } else {
      process.env.ME_LAB_SHARED_ROOT = originalSharedRoot;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("downloads and verifies a newer shared installer", async () => {
    const installerPath = writeSharedInstaller("releases/0.9.7/ME_Lab_Inventory_Setup.exe", "installer-content");
    writeManifest({
      installer_path: "releases/0.9.7/ME_Lab_Inventory_Setup.exe",
      notes: "Patch release",
      published_at: "2026-04-24T12:00:00-05:00",
      sha256: hashText("installer-content"),
      version: "0.9.7",
    });

    const updater = updaterModule.createSharedUpdater({
      currentVersion: "0.9.6",
      executablePath: process.execPath,
      userDataPath,
    });

    const available = await updater.checkForUpdate();
    expect(available.status).toBe("available");
    expect(available.latestVersion).toBe("0.9.7");

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
    expect(() => updater.installUpdate()).toThrow(/not been downloaded/i);
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

    expect((await updater.checkForUpdate()).status).toBe("available");

    const result = await updater.downloadUpdate();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/checksum/i);
    expect(() => updater.installUpdate()).toThrow(/not been downloaded/i);
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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
