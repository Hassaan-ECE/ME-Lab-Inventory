import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import {
  createInventoryRecord,
  deleteInventoryRecord,
  loadInventoryRecords,
  setArchivedRecord,
  syncInventoryWithShared,
  toggleVerifiedRecord,
  updateInventoryRecord,
} from "./inventory-db.mjs";
import { exportExcelInventory } from "./inventory-export.mjs";
import { resolveSharedDbPath, resolveSharedDirectoryPath } from "./inventory-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.mjs");
const appIconPath = path.join(__dirname, "assets", "app_icon.ico");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let sharedWatcher = null;
let sharedWatchDebounce = null;

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
    title: "ME Lab Inventory Prototype",
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
  app.setAppUserModelId("com.syedhassaan.ims-t3code-ref-design");

  ipcMain.handle("inventory:load", () => loadInventoryRecords(buildRuntimeContext()));
  ipcMain.handle("inventory:sync", () => {
    const result = syncInventoryWithShared(buildRuntimeContext());
    refreshSharedWatcher();
    return result;
  });
  ipcMain.handle("inventory:toggle-verified", (_event, recordId, nextVerified) =>
    toggleVerifiedRecord(buildRuntimeContext(), recordId, nextVerified),
  );
  ipcMain.handle("inventory:create", (_event, recordInput) =>
    createInventoryRecord(buildRuntimeContext(), recordInput),
  );
  ipcMain.handle("inventory:update", (_event, recordId, recordInput) =>
    updateInventoryRecord(buildRuntimeContext(), recordId, recordInput),
  );
  ipcMain.handle("inventory:set-archived", (_event, recordId, archived) =>
    setArchivedRecord(buildRuntimeContext(), recordId, archived),
  );
  ipcMain.handle("inventory:delete", (_event, recordId) =>
    deleteInventoryRecord(buildRuntimeContext(), recordId),
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
      title: "Select Record Picture",
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
