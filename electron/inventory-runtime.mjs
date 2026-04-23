import fs from "node:fs";
import path from "node:path";

export const DB_FILENAME = "me_lab_inventory.db";
export const SHARED_DB_FILENAME = "me_lab_shared.db";
export const SHARED_ROOT_ENV_VAR = "ME_LAB_SHARED_ROOT";
export const DEFAULT_SHARED_ROOT = "S:\\Manufacturing\\Internal\\_Syed_H_Shah\\InventoryApps\\ME";
export const SHARED_SYNC_INTERVAL_MS = 10_000;

export function resolveDbPath({ appPath, isPackaged, resourcesPath, userDataPath }) {
  if (!isPackaged) {
    const developmentCandidates = [
      path.join(appPath, "data", DB_FILENAME),
      path.join(path.dirname(appPath), "data", DB_FILENAME),
      path.join(process.cwd(), "data", DB_FILENAME),
    ];

    for (const candidatePath of developmentCandidates) {
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    throw new Error("No development database was found in the project data directory.");
  }

  const bundledSeedPath = path.join(resourcesPath, "data", DB_FILENAME);
  const runtimeDataDir = path.join(userDataPath, "data");
  const runtimeDbPath = path.join(runtimeDataDir, DB_FILENAME);

  fs.mkdirSync(runtimeDataDir, { recursive: true });
  if (!fs.existsSync(runtimeDbPath)) {
    if (!fs.existsSync(bundledSeedPath)) {
      throw new Error("Bundled database seed is missing.");
    }
    fs.copyFileSync(bundledSeedPath, runtimeDbPath);
  }

  return runtimeDbPath;
}

export function resolveSharedRootPath() {
  const configuredRoot = process.env[SHARED_ROOT_ENV_VAR]?.trim() || DEFAULT_SHARED_ROOT;
  return configuredRoot ? path.resolve(configuredRoot) : "";
}

export function resolveSharedDirectoryPath() {
  const sharedRootPath = resolveSharedRootPath();
  return sharedRootPath ? path.join(sharedRootPath, "shared") : "";
}

export function resolveSharedDbPath() {
  const sharedDirectoryPath = resolveSharedDirectoryPath();
  return sharedDirectoryPath ? path.join(sharedDirectoryPath, SHARED_DB_FILENAME) : "";
}
