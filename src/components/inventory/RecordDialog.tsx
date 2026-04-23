import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  LIFECYCLE_OPTIONS,
  WORKING_STATUS_OPTIONS,
  type InventoryRecord,
  type InventoryRecordInput,
  type LifecycleStatus,
  type WorkingStatus,
} from "@/types/inventory";

const LARGE_VIEWPORT_QUERY = "(min-width: 1024px)";

interface RecordDialogProps {
  defaultArchived?: boolean;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: (input: InventoryRecordInput) => Promise<void> | void;
  record?: InventoryRecord | null;
}

interface RecordFormState {
  archived: boolean;
  assetNumber: string;
  assignedTo: string;
  condition: string;
  description: string;
  lifecycleStatus: LifecycleStatus;
  links: string;
  location: string;
  manufacturer: string;
  model: string;
  notes: string;
  projectName: string;
  qty: string;
  serialNumber: string;
  verifiedInSurvey: boolean;
  workingStatus: WorkingStatus;
}

export function RecordDialog({ defaultArchived = false, mode, onClose, onSave, record }: RecordDialogProps) {
  const [form, setForm] = useState<RecordFormState>(() => buildFormState(record, defaultArchived));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isLargeViewport = useMediaQuery(LARGE_VIEWPORT_QUERY);
  const formId = useId();
  const showsSidebarActions = mode === "edit" && Boolean(record) && isLargeViewport;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !isSaving) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = buildRecordInput(form);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await onSave(result.value);
    } catch (submissionError) {
      setIsSaving(false);
      setError(submissionError instanceof Error ? submissionError.message : "Could not save this record.");
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-[72rem] overflow-hidden rounded-[1.75rem] border border-border/70 bg-card text-card-foreground shadow-2xl">
        <form
          className={cn("min-w-0 flex flex-1 flex-col overflow-hidden", showsSidebarActions ? "lg:border-r lg:border-border/70" : "")}
          id={formId}
          onSubmit={handleSubmit}
        >
          <div className="shrink-0 border-b border-border/70 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {mode === "edit" ? "Open Full Record" : "Add Record"}
              </p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {mode === "edit" ? "Edit Record" : "Add Record"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={form.archived ? "warning" : "secondary"}>{form.archived ? "Archive" : "Inventory"}</Badge>
              <Badge variant={form.verifiedInSurvey ? "success" : "outline"}>
                {form.verifiedInSurvey ? "Verified" : "Pending"}
              </Badge>
            </div>
          </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <Field label="Asset Number">
                <Input
                  autoFocus
                  placeholder="Optional asset tag"
                  value={form.assetNumber}
                  onChange={(event) => updateForm(setForm, "assetNumber", event.currentTarget.value)}
                />
              </Field>

              <Field label="Serial / Internal ID">
                <Input
                  placeholder="Serial or internal ID"
                  value={form.serialNumber}
                  onChange={(event) => updateForm(setForm, "serialNumber", event.currentTarget.value)}
                />
              </Field>

              <Field label="Manufacturer / Brand">
                <Input
                  placeholder="Maker, brand, or supplier"
                  value={form.manufacturer}
                  onChange={(event) => updateForm(setForm, "manufacturer", event.currentTarget.value)}
                />
              </Field>

              <Field label="Model / Part No.">
                <Input
                  placeholder="Model or part number"
                  value={form.model}
                  onChange={(event) => updateForm(setForm, "model", event.currentTarget.value)}
                />
              </Field>

              <Field label="Quantity">
                <Input
                  inputMode="decimal"
                  placeholder="Quantity on hand"
                  value={form.qty}
                  onChange={(event) => updateForm(setForm, "qty", event.currentTarget.value)}
                />
              </Field>

              <Field label="Project">
                <Input
                  placeholder="Project this record supports"
                  value={form.projectName}
                  onChange={(event) => updateForm(setForm, "projectName", event.currentTarget.value)}
                />
              </Field>

              <Field className="lg:col-span-2" label="Description">
                <Input
                  placeholder="Part or record description"
                  value={form.description}
                  onChange={(event) => updateForm(setForm, "description", event.currentTarget.value)}
                />
              </Field>

              <Field label="Location">
                <Input
                  placeholder="Shelf, room, bin, or area"
                  value={form.location}
                  onChange={(event) => updateForm(setForm, "location", event.currentTarget.value)}
                />
              </Field>

              <Field label="Used By / Assigned To">
                <Input
                  placeholder="Person or team using it"
                  value={form.assignedTo}
                  onChange={(event) => updateForm(setForm, "assignedTo", event.currentTarget.value)}
                />
              </Field>

              <Field className="lg:col-span-2" label="Links">
                <Input
                  placeholder="Product, vendor, or reference link"
                  value={form.links}
                  onChange={(event) => updateForm(setForm, "links", event.currentTarget.value)}
                />
              </Field>

              <Field label="Lifecycle">
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-shadow focus:border-ring focus:ring-[3px] focus:ring-ring/18 dark:bg-input/30"
                  value={form.lifecycleStatus}
                  onChange={(event) =>
                    updateForm(setForm, "lifecycleStatus", event.currentTarget.value as LifecycleStatus)
                  }
                >
                  {LIFECYCLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatOptionLabel(option)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Working Status">
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-shadow focus:border-ring focus:ring-[3px] focus:ring-ring/18 dark:bg-input/30"
                  value={form.workingStatus}
                  onChange={(event) =>
                    updateForm(setForm, "workingStatus", event.currentTarget.value as WorkingStatus)
                  }
                >
                  {WORKING_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatOptionLabel(option)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field className="lg:col-span-2" label="Condition">
                <Input
                  placeholder="Condition or operating note"
                  value={form.condition}
                  onChange={(event) => updateForm(setForm, "condition", event.currentTarget.value)}
                />
              </Field>

              <Field className="lg:col-span-2" label="Notes">
                <Textarea
                  placeholder="Operational notes, repair history, or provenance"
                  value={form.notes}
                  onChange={(event) => updateForm(setForm, "notes", event.currentTarget.value)}
                />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  checked={form.verifiedInSurvey}
                  className="size-4 accent-[var(--primary)]"
                  type="checkbox"
                  onChange={(event) => updateForm(setForm, "verifiedInSurvey", event.currentTarget.checked)}
                />
                Verified in survey
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  checked={form.archived}
                  className="size-4 accent-[var(--primary)]"
                  type="checkbox"
                  onChange={(event) => updateForm(setForm, "archived", event.currentTarget.checked)}
                />
                Archived record
              </label>
            </div>
          </div>

          {showsSidebarActions ? null : (
            <div className="shrink-0 border-t border-border/70 px-5 py-4">
              <DialogActions error={error} formId={formId} isSaving={isSaving} layout="footer" onClose={onClose} />
            </div>
          )}
        </form>

        {showsSidebarActions && record ? (
          <aside className="flex w-[18rem] shrink-0 flex-col bg-background/60 px-5 py-5">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Record Context</p>
                <h3 className="mt-1 text-base font-semibold text-foreground">Database Metadata</h3>
              </div>

              <div className="mt-4 space-y-4">
                <ContextRow label="Record ID" value={record.id} />
                <ContextRow label="Created" value={record.createdAt || "-"} />
                <ContextRow label="Updated" value={record.updatedAt || "-"} />
                <ContextRow label="Status" value={record.archived ? "Archived" : "Inventory"} />
                <ContextRow label="Verified" value={record.verifiedInSurvey ? "Verified" : "Pending"} />
                <ContextRow label="Manual Entry" value={record.manualEntry ? "Yes" : "No"} />
              </div>
            </div>

            <div className="mt-5 shrink-0 border-t border-border/70 pt-4">
              <DialogActions error={error} formId={formId} isSaving={isSaving} layout="sidebar" onClose={onClose} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

interface FieldProps {
  children: ReactNode;
  className?: string;
  label: string;
}

function Field({ children, className, label }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

interface ContextRowProps {
  label: string;
  value: string;
}

function ContextRow({ label, value }: ContextRowProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => undefined;
      }

      const mediaQuery = window.matchMedia(query);
      const handleChange = (): void => onStoreChange();
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    },
    () => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
      }

      return window.matchMedia(query).matches;
    },
    () => false,
  );
}

interface DialogActionsProps {
  error: string | null;
  formId: string;
  isSaving: boolean;
  layout: "footer" | "sidebar";
  onClose: () => void;
}

function DialogActions({ error, formId, isSaving, layout, onClose }: DialogActionsProps) {
  if (layout === "sidebar") {
    return (
      <>
        {error ? <p className="mb-3 text-sm text-destructive-foreground">{error}</p> : null}
        <div className="flex flex-col gap-2">
          <Button className="w-full" disabled={isSaving} variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button className="w-full" disabled={isSaving} form={formId} type="submit">
            {isSaving ? "Saving..." : "Save Record"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? <p className="mr-auto text-sm text-destructive-foreground">{error}</p> : null}
      <Button disabled={isSaving} variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button disabled={isSaving} form={formId} type="submit">
        {isSaving ? "Saving..." : "Save Record"}
      </Button>
    </div>
  );
}

function buildFormState(record: InventoryRecord | null | undefined, defaultArchived: boolean): RecordFormState {
  return {
    archived: record?.archived ?? defaultArchived,
    assetNumber: record?.assetNumber ?? "",
    assignedTo: record?.assignedTo ?? "",
    condition: record?.condition ?? "",
    description: record?.description ?? "",
    lifecycleStatus: record?.lifecycleStatus ?? "active",
    links: record?.links ?? "",
    location: record?.location ?? "",
    manufacturer: record?.manufacturer ?? "",
    model: record?.model ?? "",
    notes: record?.notes ?? "",
    projectName: record?.projectName ?? "",
    qty: record?.qty == null ? "" : String(record.qty),
    serialNumber: record?.serialNumber ?? "",
    verifiedInSurvey: record?.verifiedInSurvey ?? false,
    workingStatus: record?.workingStatus ?? "unknown",
  };
}

function buildRecordInput(
  form: RecordFormState,
): { value: InventoryRecordInput } | { error: string } {
  const qtyText = form.qty.trim();
  let qty: number | null = null;

  if (qtyText) {
    qty = Number(qtyText);
    if (!Number.isFinite(qty)) {
      return { error: "Enter quantity as a number, for example 4 or 4.5." };
    }
  }

  if (!hasIdentity(form)) {
    return {
      error: "Provide at least an asset number, serial number, manufacturer, model, or description before saving.",
    };
  }

  return {
    value: {
      archived: form.archived,
      assetNumber: form.assetNumber.trim(),
      assignedTo: form.assignedTo.trim(),
      condition: form.condition.trim(),
      description: form.description.trim(),
      lifecycleStatus: form.lifecycleStatus,
      links: form.links.trim(),
      location: form.location.trim(),
      manufacturer: form.manufacturer.trim(),
      model: form.model.trim(),
      notes: form.notes.trim(),
      projectName: form.projectName.trim(),
      qty,
      serialNumber: form.serialNumber.trim(),
      verifiedInSurvey: form.verifiedInSurvey,
      workingStatus: form.workingStatus,
    },
  };
}

function hasIdentity(form: RecordFormState): boolean {
  return Boolean(
    form.assetNumber.trim() ||
      form.serialNumber.trim() ||
      form.manufacturer.trim() ||
      form.model.trim() ||
      form.description.trim(),
  );
}

function updateForm<Key extends keyof RecordFormState>(
  setForm: Dispatch<SetStateAction<RecordFormState>>,
  key: Key,
  value: RecordFormState[Key],
): void {
  setForm((current) => ({ ...current, [key]: value }));
}

function formatOptionLabel(option: string): string {
  return option.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
