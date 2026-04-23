import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import {
  createInventoryRecord,
  deleteInventoryRecord,
  loadInventoryRecords,
  setArchivedRecord,
  toggleVerifiedRecord,
  updateInventoryRecord,
} from "./inventory-db.mjs";
import { exportExcelInventory } from "./inventory-export.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.mjs");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0b",
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
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.syedhassaan.ims-t3code-ref-design");

  ipcMain.handle("inventory:load", () =>
    loadInventoryRecords({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath("userData"),
    }),
  );
  ipcMain.handle("inventory:toggle-verified", (_event, recordId, nextVerified) =>
    toggleVerifiedRecord(
      {
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
      },
      recordId,
      nextVerified,
    ),
  );
  ipcMain.handle("inventory:create", (_event, recordInput) =>
    createInventoryRecord(
      {
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
      },
      recordInput,
    ),
  );
  ipcMain.handle("inventory:update", (_event, recordId, recordInput) =>
    updateInventoryRecord(
      {
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
      },
      recordId,
      recordInput,
    ),
  );
  ipcMain.handle("inventory:set-archived", (_event, recordId, archived) =>
    setArchivedRecord(
      {
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
      },
      recordId,
      archived,
    ),
  );
  ipcMain.handle("inventory:delete", (_event, recordId) =>
    deleteInventoryRecord(
      {
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
      },
      recordId,
    ),
  );
  ipcMain.handle("inventory:open-external", (_event, url) => shell.openExternal(url));
  ipcMain.handle("inventory:export-excel", () =>
    exportExcelInventory({
      defaultDirectoryPath: app.getPath("documents"),
      runtimeContext: {
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
      },
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
