import fs from "node:fs";
import path from "node:path";

export const DB_FILENAME = "me_lab_inventory.db";

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
