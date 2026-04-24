declare module "../../electron/inventory-db.mjs" {
  import type { InventoryEntry, InventoryEntryInput, InventorySharedStatus } from "@/types/inventory";

  interface InventorySyncResult {
    dbPath: string;
    entries: InventoryEntry[];
    entriesChanged?: boolean;
    shared: InventorySharedStatus;
  }

  interface RuntimeContext {
    appPath: string;
    isPackaged: boolean;
    resourcesPath: string;
    userDataPath: string;
  }

  export function loadInventoryEntries(runtimeContext: RuntimeContext): InventorySyncResult;

  export function syncInventoryWithShared(runtimeContext: RuntimeContext): InventorySyncResult;

  export function createInventoryEntry(
    runtimeContext: RuntimeContext,
    entryInput: InventoryEntryInput,
  ): InventoryEntry;

  export function updateInventoryEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
    entryInput: InventoryEntryInput,
  ): InventoryEntry;

  export function toggleVerifiedEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
    nextVerified: boolean,
  ): InventoryEntry;

  export function setArchivedEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
    archived: boolean,
  ): InventoryEntry;

  export function deleteInventoryEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
  ): { entryId: string };
}
