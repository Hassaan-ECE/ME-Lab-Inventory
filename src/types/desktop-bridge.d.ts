import type { InventoryEntry, InventoryEntryInput, InventorySharedStatus } from "@/types/inventory";

declare global {
  interface Window {
    inventoryDesktop?: {
      isDesktop: boolean;
      loadInventory: () => Promise<{
        dbPath: string;
        entries: InventoryEntry[];
        shared?: InventorySharedStatus;
      }>;
      syncInventory: () => Promise<{
        dbPath: string;
        entries: InventoryEntry[];
        shared: InventorySharedStatus;
      }>;
      toggleVerifiedEntry: (entryId: string, nextVerified: boolean) => Promise<InventoryEntry>;
      createEntry: (input: InventoryEntryInput) => Promise<InventoryEntry>;
      updateEntry: (entryId: string, input: InventoryEntryInput) => Promise<InventoryEntry>;
      setArchivedEntry: (entryId: string, archived: boolean) => Promise<InventoryEntry>;
      deleteEntry: (entryId: string) => Promise<{ entryId: string }>;
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
