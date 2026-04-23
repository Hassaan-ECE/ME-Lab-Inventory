import { MoonIcon, PlusIcon, SunIcon, UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InventoryScope, ThemeMode } from "@/types/inventory";

interface InventoryHeaderProps {
  archiveCount: number;
  inventoryCount: number;
  onAddRecord: () => void;
  onExportExcel: () => void;
  onExportHtml: () => void;
  onScopeChange: (scope: InventoryScope) => void;
  onThemeToggle: () => void;
  scope: InventoryScope;
  theme: ThemeMode;
}

export function InventoryHeader({
  archiveCount,
  inventoryCount,
  onAddRecord,
  onExportExcel,
  onExportHtml,
  onScopeChange,
  onThemeToggle,
  scope,
  theme,
}: InventoryHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-foreground">ME Lab Inventory</h1>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-2xl border border-border/70 bg-card/80 p-1">
            <button
              className={cn(
                "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                scope === "inventory"
                  ? "bg-success/15 text-success-foreground"
                  : "text-success-foreground/80 hover:bg-success/10 hover:text-success-foreground",
              )}
              type="button"
              onClick={() => onScopeChange("inventory")}
            >
              Inventory ({inventoryCount})
            </button>
            <button
              className={cn(
                "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                scope === "archive"
                  ? "bg-warning/15 text-warning-foreground"
                  : "text-warning-foreground/80 hover:bg-warning/10 hover:text-warning-foreground",
              )}
              type="button"
              onClick={() => onScopeChange("archive")}
            >
              Archive ({archiveCount})
            </button>
          </div>

          <Button size="sm" variant="outline" onClick={onThemeToggle}>
            {theme === "light" ? <MoonIcon className="size-3.5" /> : <SunIcon className="size-3.5" />}
            {theme === "light" ? "Dark Theme" : "Light Theme"}
          </Button>
          <Button size="sm" variant="outline" onClick={onExportExcel}>
            <UploadIcon className="size-3.5" />
            Export Excel
          </Button>
          <Button size="sm" variant="outline" onClick={onExportHtml}>
            <UploadIcon className="size-3.5" />
            Export HTML
          </Button>
          <Button size="sm" onClick={onAddRecord}>
            <PlusIcon className="size-3.5" />
            Add Record
          </Button>
        </div>
      </div>
    </header>
  );
}
