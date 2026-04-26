/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  InventoryDeleteMutationResult,
  InventoryEntry,
  InventoryEntryInput,
  InventoryEntryMutationResult,
} from "@/types/inventory";

const PROJECT_DB_PATH = path.resolve("data", "me_lab_inventory.db");

interface RuntimeContext {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
}

interface InventoryDbModule {
  createInventoryEntry: (runtimeContext: RuntimeContext, entryInput: InventoryEntryInput) => InventoryEntryMutationResult;
  deleteInventoryEntry: (runtimeContext: RuntimeContext, entryId: string) => InventoryDeleteMutationResult;
  loadInventoryEntries: (runtimeContext: RuntimeContext) => {
    dbPath: string;
    entries: InventoryEntry[];
    entriesChanged?: boolean;
    shared: { canModify: boolean; hasLocalOnlyChanges?: boolean; message: string; mutationMode?: "shared" | "local" };
  };
  setArchivedEntry: (runtimeContext: RuntimeContext, entryId: string, archived: boolean) => InventoryEntryMutationResult;
  syncInventoryWithShared: (runtimeContext: RuntimeContext) => {
    dbPath: string;
    entries: InventoryEntry[];
    entriesChanged?: boolean;
    shared: { canModify: boolean; hasLocalOnlyChanges?: boolean; mutationMode?: "shared" | "local"; sharedDbPath?: string };
  };
  toggleVerifiedEntry: (
    runtimeContext: RuntimeContext,
    entryId: string,
    nextVerified: boolean,
  ) => InventoryEntryMutationResult;
  updateInventoryEntry: (
    runtimeContext: RuntimeContext,
    entryId: string,
    entryInput: InventoryEntryInput,
  ) => InventoryEntryMutationResult;
}

describe("inventory desktop database mutations", () => {
  let inventoryDb: InventoryDbModule;
  let originalSharedRoot: string | undefined;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ims-desktop-db-"));
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
    fs.copyFileSync(PROJECT_DB_PATH, path.join(tempDir, "data", "me_lab_inventory.db"));
    originalSharedRoot = process.env.ME_LAB_SHARED_ROOT;
    process.env.ME_LAB_SHARED_ROOT = path.join(tempDir, "shared-root");
    fs.mkdirSync(process.env.ME_LAB_SHARED_ROOT, { recursive: true });
    inventoryDb = (await import(pathToFileURL(path.resolve("electron/inventory-db.mjs")).href)) as InventoryDbModule;
  });

  afterEach(() => {
    if (originalSharedRoot == null) {
      delete process.env.ME_LAB_SHARED_ROOT;
    } else {
      process.env.ME_LAB_SHARED_ROOT = originalSharedRoot;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("migrates the legacy local database and runs entry CRUD", () => {
    const runtimeContext = {
      appPath: tempDir,
      isPackaged: false,
      resourcesPath: "",
      userDataPath: "",
    };

    const loaded = inventoryDb.loadInventoryEntries(runtimeContext);
    const currentDbPath = path.join(tempDir, "data", "me_inventory.db");
    expect(loaded.dbPath).toBe(currentDbPath);
    expect(fs.existsSync(path.join(tempDir, "data", "me_lab_inventory.db"))).toBe(true);
    expect(fs.existsSync(currentDbPath)).toBe(true);
    expect(getSchemaObjectCount(currentDbPath, "equipment")).toBe(0);
    expect(getSchemaObjectCount(currentDbPath, "record_uuid")).toBe(0);
    expect(getSchemaObjectCount(currentDbPath, "entries")).toBeGreaterThan(0);

    const initialEntries = loaded.entries.length;

    const createdResult = inventoryDb.createInventoryEntry(runtimeContext, {
      archived: false,
      assetNumber: "ME-9999",
      assignedTo: "ME Team",
      condition: "New",
      description: "Desktop CRUD test entry",
      lifecycleStatus: "active",
      links: "https://example.com/test-entry",
      location: "Bench 9",
      manufacturer: "Acme",
      model: "Fixture Plate",
      notes: "Created by automated test",
      picturePath: "C:\\Pictures\\fixture-plate.jpg",
      projectName: "Regression",
      qty: 3,
      serialNumber: "SER-9999",
      verifiedInSurvey: false,
      workingStatus: "working",
    });
    const created = createdResult.entry;

    expect(createdResult.mutationMode).toBe("shared");
    expect(createdResult.message).toBe("Entry added to the ME Inventory database.");
    expect(created.description).toBe("Desktop CRUD test entry");
    expect(created.picturePath).toBe("C:\\Pictures\\fixture-plate.jpg");
    expect(inventoryDb.loadInventoryEntries(runtimeContext).entries).toHaveLength(initialEntries + 1);

    const updatedResult = inventoryDb.updateInventoryEntry(runtimeContext, created.id, {
      ...created,
      archived: false,
      assignedTo: created.assignedTo ?? "",
      condition: "Updated",
      picturePath: "C:\\Pictures\\fixture-plate-updated.jpg",
      qty: 7,
      serialNumber: created.serialNumber ?? "",
    });
    const updated = updatedResult.entry;

    expect(updatedResult.mutationMode).toBe("shared");
    expect(updated.qty).toBe(7);
    expect(updated.condition).toBe("Updated");
    expect(updated.picturePath).toBe("C:\\Pictures\\fixture-plate-updated.jpg");

    const verifiedResult = inventoryDb.toggleVerifiedEntry(runtimeContext, created.id, true);
    const verified = verifiedResult.entry;
    expect(verifiedResult.message).toBe("Verified state updated in the ME Inventory database.");
    expect(verified.verifiedInSurvey).toBe(true);

    const archivedResult = inventoryDb.setArchivedEntry(runtimeContext, created.id, true);
    const archived = archivedResult.entry;
    expect(archivedResult.message).toBe("Entry moved to the archive.");
    expect(archived.archived).toBe(true);

    const deletion = inventoryDb.deleteInventoryEntry(runtimeContext, created.id);
    expect(deletion.entryId).toBe(created.id);
    expect(inventoryDb.loadInventoryEntries(runtimeContext).entries).toHaveLength(initialEntries);
  });

  it("bootstraps the shared database from the local seed", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    const sharedDbPath = path.join(process.env.ME_LAB_SHARED_ROOT ?? "", "shared", "me_inventory_shared.db");

    expect(fs.existsSync(sharedDbPath)).toBe(false);

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);

    expect(fs.existsSync(sharedDbPath)).toBe(true);
    expect(result.shared.canModify).toBe(true);
    expect(result.entriesChanged).toBe(false);
    expect(inventoryDb.loadInventoryEntries(runtimeContext).entries.length).toBeGreaterThan(0);
  });

  it("does not rewrite either database when equal revisions have no entry changes", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    const firstSync = inventoryDb.syncInventoryWithShared(runtimeContext);
    const sharedDbPath = firstSync.shared.sharedDbPath;
    expect(sharedDbPath).toBeTruthy();

    const localDbPath = path.join(tempDir, "data", "me_inventory.db");
    const beforeLocalStat = fs.statSync(localDbPath);
    const beforeSharedStat = fs.statSync(sharedDbPath!);
    const beforeLocalRevision = getDbRevision(localDbPath);
    const beforeSharedRevision = getDbRevision(sharedDbPath!);

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);

    expect(result.entriesChanged).toBe(false);
    expect(result.entries).toHaveLength(0);
    expect(getDbRevision(localDbPath)).toBe(beforeLocalRevision);
    expect(getDbRevision(sharedDbPath!)).toBe(beforeSharedRevision);
    expect(fs.statSync(localDbPath).mtimeMs).toBe(beforeLocalStat.mtimeMs);
    expect(fs.statSync(sharedDbPath!).mtimeMs).toBe(beforeSharedStat.mtimeMs);
  });

  it("pulls shared changes into the local cache", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    const sharedDbPath = inventoryDb.syncInventoryWithShared(runtimeContext).shared.sharedDbPath;
    expect(sharedDbPath).toBeTruthy();

    const sharedDb = new DatabaseSync(sharedDbPath!);
    const target = sharedDb.prepare("SELECT entry_uuid FROM entries LIMIT 1").get();
    const targetUuid = String(target?.entry_uuid ?? "");
    expect(targetUuid).not.toBe("");
    sharedDb
      .prepare("UPDATE entries SET description = ?, updated_at = datetime('now') WHERE entry_uuid = ?")
      .run("Updated from shared test", targetUuid);
    sharedDb.prepare("UPDATE sync_state SET revision = '99', updated_at = datetime('now') WHERE id = 1").run();
    sharedDb.close();

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);

    expect(result.entriesChanged).toBe(true);
    expect(result.entries.some((entry) => entry.description === "Updated from shared test")).toBe(true);
  });

  it("overwrites divergent local cache rows with shared authority", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    inventoryDb.syncInventoryWithShared(runtimeContext);
    const target = inventoryDb.loadInventoryEntries(runtimeContext).entries[0];
    const targetUuid = target.entryUuid ?? "";
    const localDb = new DatabaseSync(path.join(tempDir, "data", "me_inventory.db"));
    localDb.prepare("UPDATE entries SET description = ? WHERE entry_uuid = ?").run("Local divergent value", targetUuid);
    localDb.close();

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);
    const refreshed = result.entries.find((entry) => entry.entryUuid === targetUuid);

    expect(result.entriesChanged).toBe(true);
    expect(refreshed?.description).toBe(target.description);
  });

  it("saves entry mutations locally when shared storage is unavailable", () => {
    process.env.ME_LAB_SHARED_ROOT = path.join(tempDir, "missing-shared-root");
    const runtimeContext = buildRuntimeContext(tempDir);
    const loaded = inventoryDb.loadInventoryEntries(runtimeContext);
    const localDbPath = path.join(tempDir, "data", "me_inventory.db");
    const initialRevision = getDbRevision(localDbPath);

    expect(loaded.entries.length).toBeGreaterThan(0);
    expect(loaded.shared.canModify).toBe(true);
    expect(loaded.shared.mutationMode).toBe("local");

    const createdResult = inventoryDb.createInventoryEntry(runtimeContext, {
      archived: false,
      assetNumber: "ME-OFFLINE",
      assignedTo: "",
      condition: "",
      description: "Offline mutation",
      lifecycleStatus: "active",
      links: "",
      location: "Offline Bench",
      manufacturer: "Offline Maker",
      model: "",
      notes: "",
      projectName: "",
      qty: null,
      serialNumber: "",
      verifiedInSurvey: false,
      workingStatus: "unknown",
    });
    const created = createdResult.entry;

    const updatedResult = inventoryDb.updateInventoryEntry(runtimeContext, created.id, {
      ...created,
      archived: false,
      assignedTo: created.assignedTo ?? "",
      condition: "Offline Updated",
      location: "Offline Shelf",
      qty: 4,
      serialNumber: created.serialNumber ?? "",
    });
    const updated = updatedResult.entry;
    const verifiedResult = inventoryDb.toggleVerifiedEntry(runtimeContext, created.id, true);
    const verified = verifiedResult.entry;
    const archivedResult = inventoryDb.setArchivedEntry(runtimeContext, created.id, true);
    const archived = archivedResult.entry;

    expect(createdResult.mutationMode).toBe("local");
    expect(createdResult.message).toBe("Entry added locally.");
    expect(createdResult.shared?.hasLocalOnlyChanges).toBe(true);
    expect(created.description).toBe("Offline mutation");
    expect(updatedResult.mutationMode).toBe("local");
    expect(updated.location).toBe("Offline Shelf");
    expect(verifiedResult.message).toBe("Verified state updated locally.");
    expect(verified.verifiedInSurvey).toBe(true);
    expect(archivedResult.message).toBe("Entry moved to the archive locally.");
    expect(archived.archived).toBe(true);
    expect(getDbRevision(localDbPath)).toBeGreaterThan(initialRevision);

    const afterMutation = inventoryDb.loadInventoryEntries(runtimeContext);
    expect(afterMutation.shared.hasLocalOnlyChanges).toBe(true);
    expect(afterMutation.entries.some((entry) => entry.id === created.id)).toBe(true);

    const deletion = inventoryDb.deleteInventoryEntry(runtimeContext, created.id);
    expect(deletion.entryId).toBe(created.id);
    expect(deletion.message).toBe("Entry deleted locally.");
    expect(inventoryDb.loadInventoryEntries(runtimeContext).entries.some((entry) => entry.id === created.id)).toBe(false);
  });

  it("pushes newer local-only changes to shared when storage reconnects", () => {
    const missingSharedRoot = path.join(tempDir, "missing-shared-root");
    process.env.ME_LAB_SHARED_ROOT = missingSharedRoot;
    const runtimeContext = buildRuntimeContext(tempDir);

    const createdResult = inventoryDb.createInventoryEntry(runtimeContext, {
      archived: false,
      assetNumber: "ME-RECONNECT",
      assignedTo: "",
      condition: "",
      description: "Reconnect local entry",
      lifecycleStatus: "active",
      links: "",
      location: "Local Cache",
      manufacturer: "Reconnect Maker",
      model: "",
      notes: "",
      projectName: "",
      qty: 1,
      serialNumber: "",
      verifiedInSurvey: false,
      workingStatus: "working",
    });
    const created = createdResult.entry;

    fs.mkdirSync(missingSharedRoot, { recursive: true });
    const syncResult = inventoryDb.syncInventoryWithShared(runtimeContext);

    expect(syncResult.shared.canModify).toBe(true);
    expect(syncResult.shared.mutationMode).toBe("shared");
    expect(syncResult.shared.hasLocalOnlyChanges).toBe(false);
    expect(syncResult.entriesChanged).toBe(false);
    expect(inventoryDb.loadInventoryEntries(runtimeContext).entries.some((entry) => entry.id === created.id)).toBe(true);

    const sharedDbPath = syncResult.shared.sharedDbPath;
    expect(sharedDbPath).toBeTruthy();
    const sharedDb = new DatabaseSync(sharedDbPath!, { readOnly: true });
    try {
      expect(created.entryUuid).toBeTruthy();
      const row = sharedDb.prepare("SELECT description FROM entries WHERE entry_uuid = ? LIMIT 1").get(String(created.entryUuid));
      expect(String(row?.description ?? "")).toBe("Reconnect local entry");
    } finally {
      sharedDb.close();
    }
  });
});

function buildRuntimeContext(appPath: string): RuntimeContext {
  return {
    appPath,
    isPackaged: false,
    resourcesPath: "",
    userDataPath: "",
  };
}

function getSchemaObjectCount(dbPath: string, value: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name LIKE ? OR sql LIKE ?")
      .get(`%${value}%`, `%${value}%`);
    return Number(row?.count ?? 0);
  } finally {
    db.close();
  }
}

function getDbRevision(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT revision FROM sync_state WHERE id = 1 LIMIT 1").get();
    return Number.parseInt(String(row?.revision ?? "0"), 10) || 0;
  } finally {
    db.close();
  }
}
