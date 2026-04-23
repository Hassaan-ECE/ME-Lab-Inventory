/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InventoryRecord, InventoryRecordInput } from "@/types/inventory";

const PROJECT_DB_PATH = path.resolve("data", "me_lab_inventory.db");

interface RuntimeContext {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
}

interface InventoryDbModule {
  createInventoryRecord: (runtimeContext: RuntimeContext, recordInput: InventoryRecordInput) => InventoryRecord;
  deleteInventoryRecord: (runtimeContext: RuntimeContext, recordId: string) => { recordId: string };
  loadInventoryRecords: (runtimeContext: RuntimeContext) => {
    dbPath: string;
    records: InventoryRecord[];
    shared: { canModify: boolean; message: string };
  };
  setArchivedRecord: (runtimeContext: RuntimeContext, recordId: string, archived: boolean) => InventoryRecord;
  syncInventoryWithShared: (runtimeContext: RuntimeContext) => {
    dbPath: string;
    records: InventoryRecord[];
    shared: { canModify: boolean; sharedDbPath?: string };
  };
  toggleVerifiedRecord: (runtimeContext: RuntimeContext, recordId: string, nextVerified: boolean) => InventoryRecord;
  updateInventoryRecord: (
    runtimeContext: RuntimeContext,
    recordId: string,
    recordInput: InventoryRecordInput,
  ) => InventoryRecord;
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

  it("creates, updates, archives, verifies, and deletes a record", () => {
    const runtimeContext = {
      appPath: tempDir,
      isPackaged: false,
      resourcesPath: "",
      userDataPath: "",
    };

    const initialRecords = inventoryDb.loadInventoryRecords(runtimeContext).records.length;

    const created = inventoryDb.createInventoryRecord(runtimeContext, {
      archived: false,
      assetNumber: "ME-9999",
      assignedTo: "ME Team",
      condition: "New",
      description: "Desktop CRUD test record",
      lifecycleStatus: "active",
      links: "https://example.com/test-record",
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

    expect(created.description).toBe("Desktop CRUD test record");
    expect(created.picturePath).toBe("C:\\Pictures\\fixture-plate.jpg");
    expect(inventoryDb.loadInventoryRecords(runtimeContext).records).toHaveLength(initialRecords + 1);

    const updated = inventoryDb.updateInventoryRecord(runtimeContext, created.id, {
      ...created,
      archived: false,
      assignedTo: created.assignedTo ?? "",
      condition: "Updated",
      picturePath: "C:\\Pictures\\fixture-plate-updated.jpg",
      qty: 7,
      serialNumber: created.serialNumber ?? "",
    });

    expect(updated.qty).toBe(7);
    expect(updated.condition).toBe("Updated");
    expect(updated.picturePath).toBe("C:\\Pictures\\fixture-plate-updated.jpg");

    const verified = inventoryDb.toggleVerifiedRecord(runtimeContext, created.id, true);
    expect(verified.verifiedInSurvey).toBe(true);

    const archived = inventoryDb.setArchivedRecord(runtimeContext, created.id, true);
    expect(archived.archived).toBe(true);

    const deletion = inventoryDb.deleteInventoryRecord(runtimeContext, created.id);
    expect(deletion.recordId).toBe(created.id);
    expect(inventoryDb.loadInventoryRecords(runtimeContext).records).toHaveLength(initialRecords);
  });

  it("bootstraps the shared database from the local seed", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    const sharedDbPath = path.join(process.env.ME_LAB_SHARED_ROOT ?? "", "shared", "me_lab_shared.db");

    expect(fs.existsSync(sharedDbPath)).toBe(false);

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);

    expect(fs.existsSync(sharedDbPath)).toBe(true);
    expect(result.shared.canModify).toBe(true);
    expect(result.records).toHaveLength(inventoryDb.loadInventoryRecords(runtimeContext).records.length);
  });

  it("pulls shared changes into the local cache", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    const sharedDbPath = inventoryDb.syncInventoryWithShared(runtimeContext).shared.sharedDbPath;
    expect(sharedDbPath).toBeTruthy();

    const sharedDb = new DatabaseSync(sharedDbPath!);
    const target = sharedDb.prepare("SELECT record_uuid FROM equipment LIMIT 1").get();
    const targetUuid = String(target?.record_uuid ?? "");
    expect(targetUuid).not.toBe("");
    sharedDb
      .prepare("UPDATE equipment SET description = ?, updated_at = datetime('now') WHERE record_uuid = ?")
      .run("Updated from shared test", targetUuid);
    sharedDb.prepare("UPDATE sync_state SET revision = '99', updated_at = datetime('now') WHERE id = 1").run();
    sharedDb.close();

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);

    expect(result.records.some((record) => record.description === "Updated from shared test")).toBe(true);
  });

  it("overwrites divergent local cache rows with shared authority", () => {
    const runtimeContext = buildRuntimeContext(tempDir);
    const syncResult = inventoryDb.syncInventoryWithShared(runtimeContext);
    const target = syncResult.records[0];
    const targetUuid = target.recordUuid ?? "";
    const localDb = new DatabaseSync(path.join(tempDir, "data", "me_lab_inventory.db"));
    localDb.prepare("UPDATE equipment SET description = ? WHERE record_uuid = ?").run("Local divergent value", targetUuid);
    localDb.close();

    const result = inventoryDb.syncInventoryWithShared(runtimeContext);
    const refreshed = result.records.find((record) => record.recordUuid === targetUuid);

    expect(refreshed?.description).toBe(target.description);
  });

  it("reports disconnected shared state and rejects mutations", () => {
    process.env.ME_LAB_SHARED_ROOT = path.join(tempDir, "missing-shared-root");
    const runtimeContext = buildRuntimeContext(tempDir);
    const loaded = inventoryDb.loadInventoryRecords(runtimeContext);

    expect(loaded.records.length).toBeGreaterThan(0);
    expect(loaded.shared.canModify).toBe(false);
    expect(() =>
      inventoryDb.createInventoryRecord(runtimeContext, {
        archived: false,
        assetNumber: "ME-OFFLINE",
        assignedTo: "",
        condition: "",
        description: "Offline mutation",
        lifecycleStatus: "active",
        links: "",
        location: "",
        manufacturer: "",
        model: "",
        notes: "",
        projectName: "",
        qty: null,
        serialNumber: "",
        verifiedInSurvey: false,
        workingStatus: "unknown",
      }),
    ).toThrow(/Shared workspace unavailable/);
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
