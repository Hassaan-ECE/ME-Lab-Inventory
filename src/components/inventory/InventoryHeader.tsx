import { ChevronDownIcon, FileCodeIcon, FileSpreadsheetIcon, MoonIcon, PlusIcon, SunIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/branding";
import { cn } from "@/lib/utils";
import type { InventoryScope, ThemeMode } from "@/types/inventory";

interface InventoryHeaderProps {
  archiveCount: number;
  canModifyEntries: boolean;
  inventoryCount: number;
  onAddEntry: () => void;
  onExportExcel: () => void;
  onExportHtml: () => void;
  onScopeChange: (scope: InventoryScope) => void;
  onThemeToggle: () => void;
  scope: InventoryScope;
  theme: ThemeMode;
}

export function InventoryHeader({
  archiveCount,
  canModifyEntries,
  inventoryCount,
  onAddEntry,
  onExportExcel,
  onExportHtml,
  onScopeChange,
  onThemeToggle,
  scope,
  theme,
}: InventoryHeaderProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setExportOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [exportOpen]);

  function handleExportExcel(): void {
    setExportOpen(false);
    onExportExcel();
  }

  function handleExportHtml(): void {
    setExportOpen(false);
    onExportHtml();
  }

  return (
    <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-foreground">ME Inventory</h1>
          <span className="text-xs font-semibold text-muted-foreground">v{APP_VERSION}</span>
        </div>

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
          <div className="relative" ref={exportMenuRef}>
            <Button
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              size="sm"
              variant="outline"
              onClick={() => setExportOpen((current) => !current)}
            >
              <UploadIcon className="size-3.5" />
              Export
              <ChevronDownIcon className="size-3.5" />
            </Button>
            {exportOpen ? (
              <div
                className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-border/70 bg-card p-2 shadow-lg"
                role="menu"
              >
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent/60"
                  role="menuitem"
                  type="button"
                  onClick={handleExportExcel}
                >
                  <FileSpreadsheetIcon className="size-4" />
                  Excel
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent/60"
                  role="menuitem"
                  type="button"
                  onClick={handleExportHtml}
                >
                  <FileCodeIcon className="size-4" />
                  HTML
                </button>
              </div>
            ) : null}
          </div>
          <Button disabled={!canModifyEntries} size="sm" onClick={onAddEntry}>
            <PlusIcon className="size-3.5" />
            Add Entry
          </Button>
        </div>
      </div>
    </header>
  );
}
