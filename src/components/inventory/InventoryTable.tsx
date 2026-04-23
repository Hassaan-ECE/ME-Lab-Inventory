import { ArrowUpDownIcon, CheckIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatLinkLabel } from "@/lib/inventory";
import type { ColumnConfig, InventoryRecord, SortState } from "@/types/inventory";

interface InventoryTableProps {
  activeRecordId?: string | null;
  canModifyRecords: boolean;
  colorRows: boolean;
  columns: readonly ColumnConfig[];
  onOpenContextMenu: (recordId: string, clientX: number, clientY: number) => void;
  onOpenRecord: (recordId: string) => void;
  onSortChange: (columnKey: ColumnConfig["key"]) => void;
  onToggleVerified: (recordId: string) => void;
  records: InventoryRecord[];
  sortState: SortState;
}

export function InventoryTable({
  activeRecordId = null,
  canModifyRecords,
  colorRows,
  columns,
  onOpenContextMenu,
  onOpenRecord,
  onSortChange,
  onToggleVerified,
  records,
  sortState,
}: InventoryTableProps) {
  return (
    <section className="flex h-full min-h-0 flex-1 overflow-hidden rounded-3xl border border-border/70 bg-card/80 shadow-sm">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed border-separate border-spacing-0">
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={getColumnStyle(column.key)} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "border-b border-border px-2.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-4 sm:py-3",
                    column.align === "center" ? "text-center" : "text-left",
                  )}
                  scope="col"
                >
                  {column.sortable ? (
                    <button
                      className={cn(
                        "inline-flex min-w-0 max-w-full items-center gap-1 transition-colors hover:text-foreground",
                        column.align === "center" ? "justify-center" : "",
                        sortState.column === column.key ? "text-foreground" : "",
                      )}
                      type="button"
                      onClick={() => onSortChange(column.key)}
                    >
                      <span>{column.label}</span>
                      <ArrowUpDownIcon className="size-3.5" />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                key={record.id}
                className={cn(
                  rowToneClass(record, colorRows),
                  activeRecordId === record.id ? "ring-1 ring-inset ring-primary/25" : "",
                  "cursor-default transition-colors hover:bg-accent/35",
                )}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onOpenContextMenu(record.id, event.clientX, event.clientY);
                }}
                onDoubleClick={(event) => {
                  if (event.target instanceof Element && event.target.closest("button,a,input")) {
                    return;
                  }
                  onOpenRecord(record.id);
                }}
              >
                {columns.map((column) => (
                  <td
                    key={`${record.id}-${column.key}`}
                    className={cn(
                      "border-b border-border/60 px-2.5 py-2.5 text-sm text-foreground/92 sm:px-4 sm:py-3",
                      column.align === "center" ? "text-center" : "text-left",
                    )}
                  >
                    {renderCell(record, column, onToggleVerified, canModifyRecords)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function renderCell(
  record: InventoryRecord,
  column: ColumnConfig,
  onToggleVerified: (recordId: string) => void,
  canModifyRecords: boolean,
) {
  switch (column.key) {
    case "verified":
      return (
        <button
          aria-label={`Toggle verified for ${record.description}`}
          className="inline-flex items-center justify-center"
          disabled={!canModifyRecords}
          type="button"
          onClick={() => onToggleVerified(record.id)}
        >
          <Badge size="sm" variant={record.verifiedInSurvey ? "success" : "outline"}>
            {record.verifiedInSurvey ? <CheckIcon className="size-3" /> : null}
            {record.verifiedInSurvey ? "Verified" : "Pending"}
          </Badge>
        </button>
      );
    case "assetNumber":
      return renderText(record.assetNumber);
    case "qty":
      return renderText(record.qty == null ? "" : String(record.qty));
    case "manufacturer":
      return renderText(record.manufacturer);
    case "model":
      return renderText(record.model);
    case "description":
      return renderText(record.description);
    case "projectName":
      return renderText(record.projectName);
    case "location":
      return renderText(record.location);
    case "links": {
      const label = formatLinkLabel(record.links);
      if (!label) {
        return renderText("");
      }
      return (
        <a
          className="inline-block max-w-full truncate font-mono text-xs text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary"
          href={record.links}
          rel="noreferrer"
          title={record.links}
          target="_blank"
        >
          {label}
        </a>
      );
    }
  }
}

function renderText(value: string) {
  if (!value.trim()) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <span className="block min-w-0 truncate" title={value}>
      {value}
    </span>
  );
}

function rowToneClass(record: InventoryRecord, colorRows: boolean): string {
  if (!colorRows) {
    return "bg-transparent";
  }

  switch (record.lifecycleStatus) {
    case "active":
      return "bg-success/10";
    case "repair":
      return "bg-warning/10";
    case "scrapped":
    case "missing":
      return "bg-destructive/10";
    case "rental":
      return "bg-accent/60";
  }
}

function getColumnStyle(columnKey: ColumnConfig["key"]): CSSProperties {
  switch (columnKey) {
    case "verified":
      return { width: "4.75rem" };
    case "qty":
      return { width: "3.75rem" };
    case "assetNumber":
      return { width: "7rem" };
    case "projectName":
      return { width: "8.5rem" };
    default:
      return {};
  }
}
