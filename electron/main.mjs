import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { exportExcelInventory } from "./inventory-export.mjs";
import { resolveSharedDbPath, resolveSharedDirectoryPath } from "./inventory-runtime.mjs";
import { createSharedUpdater } from "./updater.mjs";
import { isSafeExternalUrl } from "../shared/external-url.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.mjs");
const appIconPath = path.join(__dirname, "assets", "app_icon.ico");
const inventoryWorkerPath = resolveBundledWorkerPath(path.join(__dirname, "inventory-db-worker.mjs"));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let sharedWatcher = null;
let sharedWatchDebounce = null;
let sharedUpdater = null;
let inventoryWorker = null;
let inventoryWorkerRequestId = 0;
let backgroundSyncTimeout = null;
const inventoryWorkerRequests = new Map();

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
    void openSafeExternalUrl(url);
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
    void openSafeExternalUrl(url);
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

async function openSafeExternalUrl(url) {
  const externalUrl = String(url ?? "");
  if (!isSafeExternalUrl(externalUrl, { allowImplicitHttps: false })) {
    return false;
  }

  try {
    await shell.openExternal(externalUrl);
    return true;
  } catch {
    return false;
  }
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

function getInventoryWorker() {
  if (inventoryWorker) {
    return inventoryWorker;
  }

  inventoryWorker = new Worker(inventoryWorkerPath);
  inventoryWorker.on("message", (message) => {
    const request = inventoryWorkerRequests.get(message?.id);
    if (!request) {
      return;
    }

    inventoryWorkerRequests.delete(message.id);
    if (message.type === "error") {
      request.reject(new Error(String(message.error || "Inventory worker failed.")));
      return;
    }
    request.resolve(message.result);
  });
  inventoryWorker.on("error", (error) => {
    rejectInventoryWorkerRequests(error);
    inventoryWorker = null;
  });
  inventoryWorker.on("exit", (code) => {
    if (code !== 0) {
      rejectInventoryWorkerRequests(new Error(`Inventory worker exited with code ${code}.`));
    }
    inventoryWorker = null;
  });

  return inventoryWorker;
}

function rejectInventoryWorkerRequests(error) {
  for (const request of inventoryWorkerRequests.values()) {
    request.reject(error);
  }
  inventoryWorkerRequests.clear();
}

function invokeInventoryWorker(action, ...args) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++inventoryWorkerRequestId}`;
    inventoryWorkerRequests.set(id, { reject, resolve });
    getInventoryWorker().postMessage({
      action,
      args,
      id,
    });
  });
}

function scheduleBackgroundSync() {
  if (backgroundSyncTimeout) {
    clearTimeout(backgroundSyncTimeout);
  }

  backgroundSyncTimeout = setTimeout(() => {
    backgroundSyncTimeout = null;
    void invokeInventoryWorker("syncInventoryWithShared", buildRuntimeContext())
      .then(() => {
        refreshSharedWatcher();
        mainWindow?.webContents.send("inventory:shared-changed");
      })
      .catch(() => {
        mainWindow?.webContents.send("inventory:shared-changed");
      });
  }, 150);
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

  ipcMain.handle("inventory:load", () => invokeInventoryWorker("loadInventoryEntries", buildRuntimeContext()));
  ipcMain.handle("inventory:query", (_event, input) =>
    invokeInventoryWorker("queryInventoryEntries", buildRuntimeContext(), input),
  );
  ipcMain.handle("inventory:sync", async () => {
    const result = await invokeInventoryWorker("syncInventoryWithShared", buildRuntimeContext());
    refreshSharedWatcher();
    return result;
  });
  ipcMain.handle("inventory:toggle-verified-entry", async (_event, entryId, nextVerified) => {
    const result = await invokeInventoryWorker("toggleVerifiedEntry", buildRuntimeContext(), entryId, nextVerified);
    scheduleBackgroundSync();
    return result;
  });
  ipcMain.handle("inventory:create-entry", async (_event, entryInput) => {
    const result = await invokeInventoryWorker("createInventoryEntry", buildRuntimeContext(), entryInput);
    scheduleBackgroundSync();
    return result;
  });
  ipcMain.handle("inventory:update-entry", async (_event, entryId, entryInput) => {
    const result = await invokeInventoryWorker("updateInventoryEntry", buildRuntimeContext(), entryId, entryInput);
    scheduleBackgroundSync();
    return result;
  });
  ipcMain.handle("inventory:set-archived-entry", async (_event, entryId, archived) => {
    const result = await invokeInventoryWorker("setArchivedEntry", buildRuntimeContext(), entryId, archived);
    scheduleBackgroundSync();
    return result;
  });
  ipcMain.handle("inventory:delete-entry", async (_event, entryId) => {
    const result = await invokeInventoryWorker("deleteInventoryEntry", buildRuntimeContext(), entryId);
    scheduleBackgroundSync();
    return result;
  });
  ipcMain.handle("inventory:open-external", (_event, url) => openSafeExternalUrl(url));
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
  ipcMain.handle("inventory:update:install", () => getSharedUpdater().installUpdate());

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

app.on("before-quit", () => {
  if (backgroundSyncTimeout) {
    clearTimeout(backgroundSyncTimeout);
    backgroundSyncTimeout = null;
  }
  inventoryWorker?.terminate();
});

function resolveBundledWorkerPath(workerPath) {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!workerPath.includes(asarSegment)) {
    return workerPath;
  }

  const unpackedWorkerPath = workerPath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  return fs.existsSync(unpackedWorkerPath) ? unpackedWorkerPath : workerPath;
}
