import type { InventoryRecord, InventoryRecordInput, InventorySharedStatus } from "@/types/inventory";

declare global {
  interface Window {
    inventoryDesktop?: {
      isDesktop: boolean;
      loadInventory: () => Promise<{
        dbPath: string;
        records: InventoryRecord[];
        shared?: InventorySharedStatus;
      }>;
      syncInventory: () => Promise<{
        dbPath: string;
        records: InventoryRecord[];
        shared: InventorySharedStatus;
      }>;
      toggleVerified: (recordId: string, nextVerified: boolean) => Promise<InventoryRecord>;
      createRecord: (input: InventoryRecordInput) => Promise<InventoryRecord>;
      updateRecord: (recordId: string, input: InventoryRecordInput) => Promise<InventoryRecord>;
      setArchived: (recordId: string, archived: boolean) => Promise<InventoryRecord>;
      deleteRecord: (recordId: string) => Promise<{ recordId: string }>;
      openExternal: (url: string) => Promise<boolean>;
      openPath: (path: string) => Promise<boolean>;
      pickPicturePath: () => Promise<string | null>;
      exportExcel: () => Promise<{
        canceled: boolean;
        error?: string;
        outputPath?: string;
      }>;
      onSharedInventoryChanged?: (callback: () => void) => () => void;
    };
  }
}

export {};
