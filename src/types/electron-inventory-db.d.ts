declare module "../../electron/inventory-db.mjs" {
  import type {
    InventoryDeleteMutationResult,
    InventoryEntry,
    InventoryEntryInput,
    InventoryEntryMutationResult,
    InventorySharedStatus,
  } from "@/types/inventory";

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
  ): InventoryEntryMutationResult;

  export function updateInventoryEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
    entryInput: InventoryEntryInput,
  ): InventoryEntryMutationResult;

  export function toggleVerifiedEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
    nextVerified: boolean,
  ): InventoryEntryMutationResult;

  export function setArchivedEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
    archived: boolean,
  ): InventoryEntryMutationResult;

  export function deleteInventoryEntry(
    runtimeContext: RuntimeContext,
    entryId: string,
  ): InventoryDeleteMutationResult;
}
