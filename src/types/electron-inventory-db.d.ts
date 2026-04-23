declare module "../../electron/inventory-db.mjs" {
  import type { InventoryRecord, InventoryRecordInput, InventorySharedStatus } from "@/types/inventory";

  interface RuntimeContext {
    appPath: string;
    isPackaged: boolean;
    resourcesPath: string;
    userDataPath: string;
  }

  export function loadInventoryRecords(runtimeContext: RuntimeContext): {
    dbPath: string;
    records: InventoryRecord[];
    shared: InventorySharedStatus;
  };

  export function syncInventoryWithShared(runtimeContext: RuntimeContext): {
    dbPath: string;
    records: InventoryRecord[];
    shared: InventorySharedStatus;
  };

  export function createInventoryRecord(
    runtimeContext: RuntimeContext,
    recordInput: InventoryRecordInput,
  ): InventoryRecord;

  export function updateInventoryRecord(
    runtimeContext: RuntimeContext,
    recordId: string,
    recordInput: InventoryRecordInput,
  ): InventoryRecord;

  export function toggleVerifiedRecord(
    runtimeContext: RuntimeContext,
    recordId: string,
    nextVerified: boolean,
  ): InventoryRecord;

  export function setArchivedRecord(
    runtimeContext: RuntimeContext,
    recordId: string,
    archived: boolean,
  ): InventoryRecord;

  export function deleteInventoryRecord(
    runtimeContext: RuntimeContext,
    recordId: string,
  ): { recordId: string };
}
