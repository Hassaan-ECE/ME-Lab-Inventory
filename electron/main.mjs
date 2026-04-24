import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import {
  createInventoryEntry,
  deleteInventoryEntry,
  loadInventoryEntries,
  setArchivedEntry,
  syncInventoryWithShared,
  toggleVerifiedEntry,
  updateInventoryEntry,
} from "./inventory-db.mjs";
import { exportExcelInventory } from "./inventory-export.mjs";
import { resolveSharedDbPath, resolveSharedDirectoryPath } from "./inventory-runtime.mjs";
import { createSharedUpdater } from "./updater.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.mjs");
const appIconPath = path.join(__dirname, "assets", "app_icon.ico");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let sharedWatcher = null;
let sharedWatchDebounce = null;
let sharedUpdater = null;

function buildRuntimeContext() {
  return {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath("userData"),
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0b",
    icon: appIconPath,
    title: buildAppDisplayName(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) {
      return;
    }
    if (url.startsWith("file://")) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(projectRoot, "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (sharedWatcher?.watcher) {
      sharedWatcher.watcher.close();
    }
    sharedWatcher = null;
  });

  refreshSharedWatcher();
}

function buildAppDisplayName() {
  return `ME Inventory v${app.getVersion()}`;
}

function getSharedUpdater() {
  if (sharedUpdater) {
    return sharedUpdater;
  }

  sharedUpdater = createSharedUpdater({
    currentVersion: app.getVersion(),
    executablePath: process.execPath,
    userDataPath: app.getPath("userData"),
  });
  sharedUpdater.onStateChanged((state) => {
    mainWindow?.webContents.send("inventory:update-state-changed", state);
  });

  return sharedUpdater;
}

function refreshSharedWatcher() {
  const watchTargets = [resolveSharedDbPath(), resolveSharedDirectoryPath()].filter((candidate) =>
    candidate && fs.existsSync(candidate),
  );
  const watchTarget = watchTargets[0];

  if (!mainWindow || !watchTarget || sharedWatcher?.target === watchTarget) {
    return;
  }

  if (sharedWatcher?.watcher) {
    sharedWatcher.watcher.close();
  }

  try {
    const watcher = fs.watch(watchTarget, { persistent: false }, () => {
      if (sharedWatchDebounce) {
        clearTimeout(sharedWatchDebounce);
      }

      sharedWatchDebounce = setTimeout(() => {
        mainWindow?.webContents.send("inventory:shared-changed");
      }, 250);
    });
    sharedWatcher = { target: watchTarget, watcher };
  } catch {
    sharedWatcher = null;
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.syedhassaan.me-inventory");

  ipcMain.handle("inventory:load", () => loadInventoryEntries(buildRuntimeContext()));
  ipcMain.handle("inventory:sync", () => {
    const result = syncInventoryWithShared(buildRuntimeContext());
    refreshSharedWatcher();
    return result;
  });
  ipcMain.handle("inventory:toggle-verified-entry", (_event, entryId, nextVerified) =>
    toggleVerifiedEntry(buildRuntimeContext(), entryId, nextVerified),
  );
  ipcMain.handle("inventory:create-entry", (_event, entryInput) =>
    createInventoryEntry(buildRuntimeContext(), entryInput),
  );
  ipcMain.handle("inventory:update-entry", (_event, entryId, entryInput) =>
    updateInventoryEntry(buildRuntimeContext(), entryId, entryInput),
  );
  ipcMain.handle("inventory:set-archived-entry", (_event, entryId, archived) =>
    setArchivedEntry(buildRuntimeContext(), entryId, archived),
  );
  ipcMain.handle("inventory:delete-entry", (_event, entryId) =>
    deleteInventoryEntry(buildRuntimeContext(), entryId),
  );
  ipcMain.handle("inventory:open-external", (_event, url) => shell.openExternal(url));
  ipcMain.handle("inventory:open-path", async (_event, targetPath) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) {
      return false;
    }

    const errorMessage = await shell.openPath(targetPath.trim());
    return errorMessage === "";
  });
  ipcMain.handle("inventory:pick-picture-path", async () => {
    const options = {
      filters: [
        { extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"], name: "Images" },
        { extensions: ["*"], name: "All Files" },
      ],
      properties: ["openFile"],
      title: "Select Entry Picture",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });
  ipcMain.handle("inventory:export-excel", () =>
    exportExcelInventory({
      defaultDirectoryPath: app.getPath("documents"),
      runtimeContext: buildRuntimeContext(),
      showMessageBox: (options) => dialog.showMessageBox(mainWindow, options),
      showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
    }),
  );
  ipcMain.handle("inventory:update:check", () => getSharedUpdater().checkForUpdate());
  ipcMain.handle("inventory:update:download", () => getSharedUpdater().downloadUpdate());
  ipcMain.handle("inventory:update:install", () => {
    getSharedUpdater().installUpdate();
    setTimeout(() => app.quit(), 100);
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
