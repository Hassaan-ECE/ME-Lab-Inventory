import type {
  ColumnConfig,
  ColumnKey,
  FilterState,
  InventoryRecord,
  InventoryScope,
  SortState,
} from "@/types/inventory";
import { INVENTORY_COLUMNS } from "@/types/inventory";

export const DEFAULT_FILTERS: FilterState = {
  assetNumber: "",
  manufacturer: "",
  model: "",
  description: "",
  location: "",
};

export function buildDefaultColumnVisibility(): Record<ColumnKey, boolean> {
  return INVENTORY_COLUMNS.reduce<Record<ColumnKey, boolean>>((visibility, column) => {
    visibility[column.key] = column.defaultVisible;
    return visibility;
  }, {} as Record<ColumnKey, boolean>);
}

export function mergeColumnVisibility(
  storedValue: Partial<Record<ColumnKey, boolean>> | null | undefined,
): Record<ColumnKey, boolean> {
  return { ...buildDefaultColumnVisibility(), ...storedValue };
}

export function getVisibleColumns(columnVisibility: Record<ColumnKey, boolean>): ColumnConfig[] {
  return INVENTORY_COLUMNS.filter((column) => columnVisibility[column.key]);
}

export function getVisibleDataColumnCount(columnVisibility: Record<ColumnKey, boolean>): number {
  return INVENTORY_COLUMNS.filter((column) => column.key !== "verified" && columnVisibility[column.key]).length;
}

export function formatLinkLabel(link: string): string {
  const text = link.trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = new URL(text);
    const compact = `${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
    if (compact.length <= 54) {
      return compact;
    }
    return `${compact.slice(0, 51)}...`;
  } catch {
    if (text.length <= 54) {
      return text;
    }
    return `${text.slice(0, 51)}...`;
  }
}

export function getInventoryCounts(records: InventoryRecord[]): {
  inventory: number;
  archive: number;
  total: number;
  verified: number;
} {
  const archive = records.filter((record) => record.archived).length;
  const verified = records.filter((record) => record.verifiedInSurvey).length;

  return {
    inventory: records.length - archive,
    archive,
    total: records.length,
    verified,
  };
}

export function hasActiveFilters(filters: FilterState): boolean {
  return Object.values(filters).some((value) => value.trim().length > 0);
}

export function filterRecords(
  records: InventoryRecord[],
  scope: InventoryScope,
  query: string,
  filters: FilterState,
): InventoryRecord[] {
  const normalizedQuery = query.trim().toLowerCase();

  return records.filter((record) => {
    if (scope === "inventory" && record.archived) {
      return false;
    }
    if (scope === "archive" && !record.archived) {
      return false;
    }

    const fieldFiltersMatch =
      includesText(record.assetNumber, filters.assetNumber) &&
      includesText(record.manufacturer, filters.manufacturer) &&
      includesText(record.model, filters.model) &&
      includesText(record.description, filters.description) &&
      includesText(record.location, filters.location);

    if (!fieldFiltersMatch) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      record.assetNumber,
      record.serialNumber ?? "",
      record.manufacturer,
      record.model,
      record.description,
      record.projectName,
      record.location,
      record.links,
      record.notes,
      record.lifecycleStatus,
      record.workingStatus,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

export function sortRecords(records: InventoryRecord[], sortState: SortState): InventoryRecord[] {
  const multiplier = sortState.direction === "asc" ? 1 : -1;

  return [...records].sort((left, right) => {
    const leftValue = getSortValue(left, sortState.column);
    const rightValue = getSortValue(right, sortState.column);
    const leftBlank = isBlankValue(leftValue);
    const rightBlank = isBlankValue(rightValue);

    if (leftBlank && rightBlank) {
      return 0;
    }
    if (leftBlank) {
      return 1;
    }
    if (rightBlank) {
      return -1;
    }
    if (leftValue < rightValue) {
      return -1 * multiplier;
    }
    if (leftValue > rightValue) {
      return 1 * multiplier;
    }
    return 0;
  });
}

export function buildResultsLabel(
  count: number,
  scope: InventoryScope,
  query: string,
  filters: FilterState,
): string {
  const filtersActive = hasActiveFilters(filters);
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    if (scope === "archive" && count === 0 && !filtersActive) {
      return "No archived records yet";
    }
    if (filtersActive) {
      return `Showing ${count} filtered ${scope === "archive" ? "archived" : "equipment"} records`;
    }
    return `Showing all ${count} ${scope === "archive" ? "archived" : "equipment"} records`;
  }

  if (count === 0) {
    return scope === "archive"
      ? `No archived results for "${trimmedQuery}"`
      : `No results for "${trimmedQuery}"`;
  }

  const suffix = filtersActive ? " after column filters" : "";
  const resultWord = count === 1 ? "result" : "results";
  if (scope === "archive") {
    return `${count} archived ${resultWord} for "${trimmedQuery}"${suffix}`;
  }
  return `${count} ${resultWord} for "${trimmedQuery}"${suffix}`;
}

function includesText(value: string, filterValue: string): boolean {
  const filter = filterValue.trim().toLowerCase();
  if (!filter) {
    return true;
  }
  return value.toLowerCase().includes(filter);
}

function getSortValue(record: InventoryRecord, column: ColumnKey): number | string {
  switch (column) {
    case "verified":
      return record.verifiedInSurvey ? 1 : 0;
    case "qty":
      return record.qty ?? Number.POSITIVE_INFINITY;
    case "assetNumber":
      return record.assetNumber.trim().toLowerCase();
    case "manufacturer":
      return record.manufacturer.trim().toLowerCase();
    case "model":
      return record.model.trim().toLowerCase();
    case "description":
      return record.description.trim().toLowerCase();
    case "projectName":
      return record.projectName.trim().toLowerCase();
    case "location":
      return record.location.trim().toLowerCase();
    case "links":
      return formatLinkLabel(record.links).toLowerCase();
  }
}

function isBlankValue(value: number | string): boolean {
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  return value.trim().length === 0;
}
