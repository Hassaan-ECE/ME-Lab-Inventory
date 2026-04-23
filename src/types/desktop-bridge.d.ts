import type { InventoryRecord, InventoryRecordInput } from "@/types/inventory";

declare global {
  interface Window {
    inventoryDesktop?: {
      isDesktop: boolean;
      loadInventory: () => Promise<{
        dbPath: string;
        records: InventoryRecord[];
      }>;
      toggleVerified: (recordId: string, nextVerified: boolean) => Promise<InventoryRecord>;
      createRecord: (input: InventoryRecordInput) => Promise<InventoryRecord>;
      updateRecord: (recordId: string, input: InventoryRecordInput) => Promise<InventoryRecord>;
      setArchived: (recordId: string, archived: boolean) => Promise<InventoryRecord>;
      deleteRecord: (recordId: string) => Promise<{ recordId: string }>;
      openExternal: (url: string) => Promise<boolean>;
    };
  }
}

export {};
