import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("inventoryDesktop", {
  isDesktop: true,
  loadInventory: () => ipcRenderer.invoke("inventory:load"),
  syncInventory: () => ipcRenderer.invoke("inventory:sync"),
  toggleVerifiedEntry: (entryId, nextVerified) =>
    ipcRenderer.invoke("inventory:toggle-verified-entry", entryId, nextVerified),
  createEntry: (entryInput) => ipcRenderer.invoke("inventory:create-entry", entryInput),
  updateEntry: (entryId, entryInput) => ipcRenderer.invoke("inventory:update-entry", entryId, entryInput),
  setArchivedEntry: (entryId, archived) => ipcRenderer.invoke("inventory:set-archived-entry", entryId, archived),
  deleteEntry: (entryId) => ipcRenderer.invoke("inventory:delete-entry", entryId),
  openExternal: (url) => ipcRenderer.invoke("inventory:open-external", url),
  openPath: (targetPath) => ipcRenderer.invoke("inventory:open-path", targetPath),
  pickPicturePath: () => ipcRenderer.invoke("inventory:pick-picture-path"),
  exportExcel: () => ipcRenderer.invoke("inventory:export-excel"),
  onSharedInventoryChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("inventory:shared-changed", listener);
    return () => ipcRenderer.removeListener("inventory:shared-changed", listener);
  },
});
