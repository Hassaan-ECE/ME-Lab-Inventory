import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { InventoryRecord, InventoryScope } from "@/types/inventory";

export type RecordContextAction = "open" | "open-link" | "search-online" | "archive-toggle" | "delete";

interface RecordContextMenuProps {
  onAction: (action: RecordContextAction) => void;
  onClose: () => void;
  position: {
    x: number;
    y: number;
  };
  record: InventoryRecord;
  scope: InventoryScope;
}

export function RecordContextMenu({ onAction, onClose, position, record, scope }: RecordContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const archiveLabel = scope === "archive" || record.archived ? "Restore Record" : "Archive Record";

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30"
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="absolute w-56 rounded-2xl border border-border/70 bg-card p-2 shadow-xl"
        style={{ left: position.x, top: position.y }}
      >
        <div className="px-2 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Record Actions</p>
          <p className="mt-1 truncate text-sm font-medium text-foreground">{record.description || record.manufacturer || "Untitled record"}</p>
        </div>

        <div className="mt-1 space-y-1">
          <MenuButton label="Open Full Record" onClick={() => onAction("open")} />
          <MenuButton disabled={!record.links.trim()} label="Open Saved Link" onClick={() => onAction("open-link")} />
          <MenuButton label="Search Online" onClick={() => onAction("search-online")} />
          <div className="my-1 h-px bg-border/70" />
          <MenuButton label={archiveLabel} onClick={() => onAction("archive-toggle")} />
          <MenuButton destructive label="Delete Record" onClick={() => onAction("delete")} />
        </div>
      </div>
    </div>
  );
}

interface MenuButtonProps {
  destructive?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function MenuButton({ destructive = false, disabled = false, label, onClick }: MenuButtonProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition-colors",
        destructive ? "text-destructive-foreground hover:bg-destructive/8" : "text-foreground hover:bg-accent/60",
        disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : "",
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
