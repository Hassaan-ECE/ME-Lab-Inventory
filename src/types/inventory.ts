export type InventoryScope = "inventory" | "archive";
export type ThemeMode = "light" | "dark";
export type SortDirection = "asc" | "desc";
export type LifecycleStatus = "active" | "repair" | "scrapped" | "missing" | "rental";
export type WorkingStatus = "working" | "limited" | "not_working" | "unknown";

export const LIFECYCLE_OPTIONS = ["active", "repair", "scrapped", "missing", "rental"] as const satisfies readonly LifecycleStatus[];
export const WORKING_STATUS_OPTIONS = ["unknown", "working", "limited", "not_working"] as const satisfies readonly WorkingStatus[];

export interface InventoryRecord {
  id: string;
  assetNumber: string;
  serialNumber?: string;
  qty: number | null;
  manufacturer: string;
  model: string;
  description: string;
  projectName: string;
  location: string;
  assignedTo?: string;
  links: string;
  notes: string;
  lifecycleStatus: LifecycleStatus;
  workingStatus: WorkingStatus;
  condition?: string;
  verifiedInSurvey: boolean;
  archived: boolean;
  createdAt?: string;
  updatedAt: string;
  recordUuid?: string;
  manualEntry?: boolean;
  picturePath?: string;
}

export interface InventoryRecordInput {
  assetNumber: string;
  serialNumber: string;
  qty: number | null;
  manufacturer: string;
  model: string;
  description: string;
  projectName: string;
  location: string;
  assignedTo: string;
  links: string;
  notes: string;
  lifecycleStatus: LifecycleStatus;
  workingStatus: WorkingStatus;
  condition: string;
  verifiedInSurvey: boolean;
  archived: boolean;
}

export interface FilterState {
  assetNumber: string;
  manufacturer: string;
  model: string;
  description: string;
  location: string;
}

export interface ColumnConfig {
  key:
    | "verified"
    | "assetNumber"
    | "qty"
    | "manufacturer"
    | "model"
    | "description"
    | "projectName"
    | "location"
    | "links";
  label: string;
  defaultVisible: boolean;
  sortable: boolean;
  align?: "left" | "center";
}

export type ColumnKey = ColumnConfig["key"];

export interface SortState {
  column: ColumnKey;
  direction: SortDirection;
}

export const INVENTORY_COLUMNS = [
  { key: "verified", label: "Verified", defaultVisible: true, sortable: true, align: "center" },
  { key: "assetNumber", label: "Asset #", defaultVisible: false, sortable: true },
  { key: "qty", label: "Qty", defaultVisible: true, sortable: true, align: "center" },
  { key: "manufacturer", label: "Manufacturer", defaultVisible: true, sortable: true },
  { key: "model", label: "Model", defaultVisible: true, sortable: true },
  { key: "description", label: "Description", defaultVisible: true, sortable: true },
  { key: "projectName", label: "Project", defaultVisible: false, sortable: true },
  { key: "location", label: "Location", defaultVisible: true, sortable: true },
  { key: "links", label: "Links", defaultVisible: true, sortable: true },
] as const satisfies readonly ColumnConfig[];
