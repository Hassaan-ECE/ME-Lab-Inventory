import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("inventoryDesktop", {
  isDesktop: true,
  loadInventory: () => ipcRenderer.invoke("inventory:load"),
  toggleVerified: (recordId, nextVerified) =>
    ipcRenderer.invoke("inventory:toggle-verified", recordId, nextVerified),
  createRecord: (recordInput) => ipcRenderer.invoke("inventory:create", recordInput),
  updateRecord: (recordId, recordInput) => ipcRenderer.invoke("inventory:update", recordId, recordInput),
  setArchived: (recordId, archived) => ipcRenderer.invoke("inventory:set-archived", recordId, archived),
  deleteRecord: (recordId) => ipcRenderer.invoke("inventory:delete", recordId),
  openExternal: (url) => ipcRenderer.invoke("inventory:open-external", url),
  exportExcel: () => ipcRenderer.invoke("inventory:export-excel"),
});
