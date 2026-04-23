import { useEffect, useRef, useState } from "react";

import { ColumnMenu } from "@/components/inventory/ColumnMenu";
import { EmptyResults } from "@/components/inventory/EmptyResults";
import { FilterPanel } from "@/components/inventory/FilterPanel";
import { InventoryHeader } from "@/components/inventory/InventoryHeader";
import { RecordContextMenu, type RecordContextAction } from "@/components/inventory/RecordContextMenu";
import { RecordDialog } from "@/components/inventory/RecordDialog";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { SearchCard } from "@/components/inventory/SearchCard";
import { StatusStrip } from "@/components/inventory/StatusStrip";
import { MOCK_INVENTORY } from "@/data/mockInventory";
import {
  DEFAULT_FILTERS,
  buildDefaultColumnVisibility,
  buildResultsLabel,
  filterRecords,
  getInventoryCounts,
  getVisibleColumns,
  getVisibleDataColumnCount,
  mergeColumnVisibility,
  sortRecords,
} from "@/lib/inventory";
import { INVENTORY_COLUMNS } from "@/types/inventory";
import type {
  ColumnKey,
  FilterState,
  InventoryRecord,
  InventoryRecordInput,
  InventoryScope,
  SortState,
  ThemeMode,
} from "@/types/inventory";

const THEME_STORAGE_KEY = "ims.t3.theme";
const COLOR_ROWS_STORAGE_KEY = "ims.t3.colorRows";
const COLUMN_VISIBILITY_STORAGE_KEY = "ims.t3.columnVisibility";

interface DialogState {
  mode: "add" | "edit";
  recordId?: string;
}

interface ContextMenuState {
  recordId: string;
  x: number;
  y: number;
}

export function InventoryPrototype() {
  const [records, setRecords] = useState<InventoryRecord[]>(() => (hasDesktopBridge() ? [] : MOCK_INVENTORY));
  const [dataSource, setDataSource] = useState<"desktop" | "mock">(() => (hasDesktopBridge() ? "desktop" : "mock"));
  const [scope, setScope] = useState<InventoryScope>("inventory");
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colorRows, setColorRows] = useState<boolean>(() => readColorRows());
  const [columnVisibility, setColumnVisibility] = useState<Record<ColumnKey, boolean>>(() => readColumnVisibility());
  const [sortState, setSortState] = useState<SortState>({ column: "manufacturer", direction: "asc" });
  const [isLoading, setIsLoading] = useState<boolean>(() => hasDesktopBridge());
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(COLOR_ROWS_STORAGE_KEY, JSON.stringify(colorRows));
  }, [colorRows]);

  useEffect(() => {
    localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadRecordsFromDesktop(): Promise<void> {
      if (!window.inventoryDesktop?.loadInventory) {
        return;
      }

      try {
        const payload = await window.inventoryDesktop.loadInventory();
        if (!active) {
          return;
        }
        setRecords(payload.records);
        setDataSource("desktop");
        setStatusOverride(null);
      } catch {
        if (!active) {
          return;
        }
        setRecords(MOCK_INVENTORY);
        setDataSource("mock");
        announceStatus("Database unavailable. Falling back to bundled mock data.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadRecordsFromDesktop();

    return () => {
      active = false;
    };
  }, []);

  const filteredRecords = filterRecords(records, scope, query, filters);
  const sortedRecords = sortRecords(filteredRecords, sortState);
  const counts = getInventoryCounts(records);
  const resultsLabel = isLoading ? "Loading inventory records..." : buildResultsLabel(sortedRecords.length, scope, query, filters);
  const visibleColumns = getVisibleColumns(columnVisibility);
  const statusMessage = isLoading
    ? "Loading ME inventory database..."
    : statusOverride ?? `Total: ${counts.total} | Verified: ${counts.verified}/${counts.total} | Import Issues: 0`;
  const dialogRecord = dialogState?.mode === "edit" ? records.find((record) => record.id === dialogState.recordId) ?? null : null;
  const contextRecord = contextMenu ? records.find((record) => record.id === contextMenu.recordId) ?? null : null;

  function announceStatus(message: string): void {
    setStatusOverride(message);

    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
    }

    statusTimeoutRef.current = window.setTimeout(() => {
      setStatusOverride(null);
    }, 2400);
  }

  function handleThemeToggle(): void {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  function handleFilterChange(field: keyof FilterState, value: string): void {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function handleClearFilters(): void {
    setFilters(DEFAULT_FILTERS);
  }

  function handleSortChange(column: ColumnKey): void {
    setSortState((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function handleToolbarAction(label: string): void {
    announceStatus(`${label} is a visual-only action in the prototype.`);
  }

  function handleAddRecord(): void {
    setContextMenu(null);
    setDialogState({ mode: "add" });
  }

  function handleOpenRecord(recordId: string): void {
    setContextMenu(null);
    setDialogState({ mode: "edit", recordId });
  }

  function handleOpenContextMenu(recordId: string, clientX: number, clientY: number): void {
    const menuWidth = 240;
    const menuHeight = 264;
    const maxX = typeof window === "undefined" ? clientX : Math.max(12, window.innerWidth - menuWidth - 12);
    const maxY = typeof window === "undefined" ? clientY : Math.max(12, window.innerHeight - menuHeight - 12);

    setContextMenu({
      recordId,
      x: Math.min(clientX, maxX),
      y: Math.min(clientY, maxY),
    });
  }

  async function handleToggleVerified(recordId: string): Promise<void> {
    const nextVerified = !records.find((record) => record.id === recordId)?.verifiedInSurvey;

    if (dataSource === "desktop" && window.inventoryDesktop?.toggleVerified && isDatabaseRecordId(recordId)) {
      try {
        const updatedRecord = await window.inventoryDesktop.toggleVerified(recordId, nextVerified);
        setRecords((current) =>
          current.map((record) => (record.id === recordId ? updatedRecord : record)),
        );
        announceStatus("Verified state updated in the ME inventory database.");
        return;
      } catch {
        announceStatus("Could not update the ME inventory database.");
        return;
      }
    }

    setRecords((current) =>
      current.map((record) =>
        record.id === recordId ? { ...record, verifiedInSurvey: !record.verifiedInSurvey } : record,
      ),
    );
    announceStatus("Verified state updated locally in the prototype.");
  }

  async function handleSaveRecord(input: InventoryRecordInput): Promise<void> {
    if (dialogState?.mode === "edit" && dialogState.recordId) {
      const existingRecord = records.find((record) => record.id === dialogState.recordId);
      if (!existingRecord) {
        throw new Error("The selected record could not be found.");
      }

      if (dataSource === "desktop" && window.inventoryDesktop?.updateRecord && isDatabaseRecordId(dialogState.recordId)) {
        const updatedRecord = await window.inventoryDesktop.updateRecord(dialogState.recordId, input);
        setRecords((current) => current.map((record) => (record.id === updatedRecord.id ? updatedRecord : record)));
        announceStatus("Record updated in the ME inventory database.");
      } else {
        const updatedRecord = buildLocalUpdatedRecord(existingRecord, input);
        setRecords((current) => current.map((record) => (record.id === updatedRecord.id ? updatedRecord : record)));
        announceStatus("Record updated locally in the prototype.");
      }

      setDialogState(null);
      return;
    }

    if (dataSource === "desktop" && window.inventoryDesktop?.createRecord) {
      const createdRecord = await window.inventoryDesktop.createRecord(input);
      setRecords((current) => [createdRecord, ...current]);
      announceStatus("Record added to the ME inventory database.");
    } else {
      const createdRecord = buildLocalCreatedRecord(input);
      setRecords((current) => [createdRecord, ...current]);
      announceStatus("Record added locally in the prototype.");
    }

    setDialogState(null);
  }

  async function handleArchiveChange(recordId: string, archived: boolean): Promise<void> {
    const record = records.find((entry) => entry.id === recordId);
    if (!record || record.archived === archived) {
      return;
    }

    const shouldProceed = window.confirm(
      archived
        ? "Archive this record and move it out of the Inventory view?"
        : "Restore this record and move it back into Inventory?",
    );
    if (!shouldProceed) {
      return;
    }

    if (dataSource === "desktop" && window.inventoryDesktop?.setArchived && isDatabaseRecordId(recordId)) {
      const updatedRecord = await window.inventoryDesktop.setArchived(recordId, archived);
      setRecords((current) => current.map((entry) => (entry.id === updatedRecord.id ? updatedRecord : entry)));
    } else {
      setRecords((current) =>
        current.map((entry) => (entry.id === recordId ? { ...entry, archived, updatedAt: new Date().toISOString() } : entry)),
      );
    }

    announceStatus(archived ? "Record moved to the archive." : "Record restored to inventory.");
  }

  async function handleDeleteRecord(recordId: string): Promise<void> {
    const record = records.find((entry) => entry.id === recordId);
    if (!record) {
      return;
    }

    const shouldProceed = window.confirm(`Delete this record?\n\n${record.description || record.manufacturer || `ID ${recordId}`}`);
    if (!shouldProceed) {
      return;
    }

    if (dataSource === "desktop" && window.inventoryDesktop?.deleteRecord && isDatabaseRecordId(recordId)) {
      await window.inventoryDesktop.deleteRecord(recordId);
    }

    setRecords((current) => current.filter((entry) => entry.id !== recordId));
    announceStatus("Record deleted.");
  }

  async function handleOpenRecordLink(recordId: string): Promise<void> {
    const record = records.find((entry) => entry.id === recordId);
    if (!record) {
      return;
    }

    const linkText = record.links.trim();
    if (!linkText) {
      announceStatus("No link is saved for this record.");
      return;
    }

    const externalUrl = normalizeExternalUrl(linkText);
    if (!externalUrl) {
      announceStatus("This link is not in a valid format.");
      return;
    }

    const opened = await openExternalUrl(externalUrl);
    if (!opened) {
      announceStatus("Could not open the saved link.");
      return;
    }

    announceStatus(`Opened link: ${linkText}`);
  }

  async function handleSearchOnline(recordId: string): Promise<void> {
    const record = records.find((entry) => entry.id === recordId);
    if (!record) {
      return;
    }

    const queryText = [record.manufacturer, record.model, record.description].filter((value) => value.trim()).join(" ").trim();
    if (!queryText) {
      announceStatus("No searchable record details were found.");
      return;
    }

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryText)}`;
    const opened = await openExternalUrl(searchUrl);
    if (!opened) {
      announceStatus("Could not open the browser for this search.");
      return;
    }

    announceStatus(`Opened web search: ${queryText}`);
  }

  async function handleContextAction(action: RecordContextAction): Promise<void> {
    const recordId = contextMenu?.recordId;
    setContextMenu(null);

    if (!recordId) {
      return;
    }

    switch (action) {
      case "open":
        handleOpenRecord(recordId);
        return;
      case "open-link":
        await handleOpenRecordLink(recordId);
        return;
      case "search-online":
        await handleSearchOnline(recordId);
        return;
      case "archive-toggle": {
        const record = records.find((entry) => entry.id === recordId);
        if (!record) {
          return;
        }
        await handleArchiveChange(recordId, !record.archived);
        return;
      }
      case "delete":
        await handleDeleteRecord(recordId);
        return;
    }
  }

  function handleToggleColumn(columnKey: ColumnKey): void {
    setColumnVisibility((current) => {
      const nextValue = !current[columnKey];
      const visibleDataColumns = getVisibleDataColumnCount(current);

      if (!nextValue && columnKey !== "verified" && visibleDataColumns === 1) {
        return current;
      }

      return { ...current, [columnKey]: nextValue };
    });
  }

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <main className="flex h-full min-h-0 flex-col overflow-hidden">
        <InventoryHeader
          archiveCount={counts.archive}
          inventoryCount={counts.inventory}
          onAddRecord={handleAddRecord}
          onScopeChange={setScope}
          onToolbarAction={handleToolbarAction}
          onThemeToggle={handleThemeToggle}
          scope={scope}
          theme={theme}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden px-3 py-4 sm:px-5">
          <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-hidden">
            <SearchCard
              colorRows={colorRows}
              columnMenu={
                <ColumnMenu columns={INVENTORY_COLUMNS} onToggleColumn={handleToggleColumn} visibility={columnVisibility} />
              }
              filtersOpen={filtersOpen}
              onColorRowsChange={setColorRows}
              onFiltersToggle={() => setFiltersOpen((current) => !current)}
              onQueryChange={setQuery}
              query={query}
              resultsLabel={resultsLabel}
              scope={scope}
            />

            {filtersOpen ? <FilterPanel filters={filters} onChange={handleFilterChange} onClear={handleClearFilters} /> : null}

            <div className="min-h-0 flex-1 overflow-hidden">
              {isLoading ? (
                <section className="flex h-full min-h-0 flex-1 items-center justify-center rounded-3xl border border-border/70 bg-card/80 shadow-sm">
                  <div className="text-sm text-muted-foreground">Loading ME inventory database...</div>
                </section>
              ) : sortedRecords.length > 0 ? (
                <InventoryTable
                  activeRecordId={contextMenu?.recordId ?? dialogRecord?.id ?? null}
                  colorRows={colorRows}
                  columns={visibleColumns}
                  onOpenContextMenu={handleOpenContextMenu}
                  onOpenRecord={handleOpenRecord}
                  onSortChange={handleSortChange}
                  onToggleVerified={(recordId) => {
                    void handleToggleVerified(recordId);
                  }}
                  records={sortedRecords}
                  sortState={sortState}
                />
              ) : (
                <EmptyResults query={query} scope={scope} onAddRecord={handleAddRecord} />
              )}
            </div>
          </div>
        </div>

        <StatusStrip message={statusMessage} />
      </main>

      {contextMenu && contextRecord ? (
        <RecordContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          record={contextRecord}
          scope={scope}
          onAction={(action) => {
            void handleContextAction(action);
          }}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {dialogState ? (
        <RecordDialog
          key={`${dialogState.mode}-${dialogState.recordId ?? scope}`}
          defaultArchived={scope === "archive"}
          mode={dialogState.mode}
          record={dialogRecord}
          onClose={() => setDialogState(null)}
          onSave={handleSaveRecord}
        />
      ) : null}
    </div>
  );
}

function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.inventoryDesktop?.isDesktop);
}

function isDatabaseRecordId(recordId: string): boolean {
  return /^\d+$/.test(recordId);
}

async function openExternalUrl(url: string): Promise<boolean> {
  if (window.inventoryDesktop?.openExternal) {
    return window.inventoryDesktop.openExternal(url);
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

function normalizeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  }
}

function buildLocalCreatedRecord(input: InventoryRecordInput): InventoryRecord {
  const timestamp = new Date().toISOString();

  return {
    id: `local-${Date.now()}`,
    recordUuid: "",
    assetNumber: input.assetNumber,
    serialNumber: input.serialNumber,
    qty: input.qty,
    manufacturer: input.manufacturer,
    model: input.model,
    description: input.description,
    projectName: input.projectName,
    location: input.location,
    assignedTo: input.assignedTo,
    links: input.links,
    notes: input.notes,
    lifecycleStatus: input.lifecycleStatus,
    workingStatus: input.workingStatus,
    condition: input.condition,
    verifiedInSurvey: input.verifiedInSurvey,
    archived: input.archived,
    manualEntry: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildLocalUpdatedRecord(existingRecord: InventoryRecord, input: InventoryRecordInput): InventoryRecord {
  return {
    ...existingRecord,
    assetNumber: input.assetNumber,
    serialNumber: input.serialNumber,
    qty: input.qty,
    manufacturer: input.manufacturer,
    model: input.model,
    description: input.description,
    projectName: input.projectName,
    location: input.location,
    assignedTo: input.assignedTo,
    links: input.links,
    notes: input.notes,
    lifecycleStatus: input.lifecycleStatus,
    workingStatus: input.workingStatus,
    condition: input.condition,
    verifiedInSurvey: input.verifiedInSurvey,
    archived: input.archived,
    updatedAt: new Date().toISOString(),
  };
}

function readTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" ? "dark" : "light";
}

function readColorRows(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  const storedValue = window.localStorage.getItem(COLOR_ROWS_STORAGE_KEY);
  return storedValue == null ? true : storedValue === "true";
}

function readColumnVisibility(): Record<ColumnKey, boolean> {
  if (typeof window === "undefined") {
    return buildDefaultColumnVisibility();
  }

  const storedValue = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
  if (!storedValue) {
    return buildDefaultColumnVisibility();
  }

  try {
    return mergeColumnVisibility(JSON.parse(storedValue) as Partial<Record<ColumnKey, boolean>>);
  } catch {
    return buildDefaultColumnVisibility();
  }
}
