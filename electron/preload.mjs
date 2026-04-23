import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("inventoryDesktop", {
  isDesktop: true,
  loadInventory: () => ipcRenderer.invoke("inventory:load"),
  syncInventory: () => ipcRenderer.invoke("inventory:sync"),
  toggleVerified: (recordId, nextVerified) =>
    ipcRenderer.invoke("inventory:toggle-verified", recordId, nextVerified),
  createRecord: (recordInput) => ipcRenderer.invoke("inventory:create", recordInput),
  updateRecord: (recordId, recordInput) => ipcRenderer.invoke("inventory:update", recordId, recordInput),
  setArchived: (recordId, archived) => ipcRenderer.invoke("inventory:set-archived", recordId, archived),
  deleteRecord: (recordId) => ipcRenderer.invoke("inventory:delete", recordId),
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
