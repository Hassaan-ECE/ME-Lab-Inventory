/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  loadInventoryRecords: (runtimeContext: RuntimeContext) => { dbPath: string; records: InventoryRecord[] };
  setArchivedRecord: (runtimeContext: RuntimeContext, recordId: string, archived: boolean) => InventoryRecord;
  toggleVerifiedRecord: (runtimeContext: RuntimeContext, recordId: string, nextVerified: boolean) => InventoryRecord;
  updateInventoryRecord: (
    runtimeContext: RuntimeContext,
    recordId: string,
    recordInput: InventoryRecordInput,
  ) => InventoryRecord;
}

describe("inventory desktop database mutations", () => {
  let inventoryDb: InventoryDbModule;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ims-desktop-db-"));
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
    fs.copyFileSync(PROJECT_DB_PATH, path.join(tempDir, "data", "me_lab_inventory.db"));
    inventoryDb = (await import(pathToFileURL(path.resolve("electron/inventory-db.mjs")).href)) as InventoryDbModule;
  });

  afterEach(() => {
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
      projectName: "Regression",
      qty: 3,
      serialNumber: "SER-9999",
      verifiedInSurvey: false,
      workingStatus: "working",
    });

    expect(created.description).toBe("Desktop CRUD test record");
    expect(inventoryDb.loadInventoryRecords(runtimeContext).records).toHaveLength(initialRecords + 1);

    const updated = inventoryDb.updateInventoryRecord(runtimeContext, created.id, {
      ...created,
      archived: false,
      assignedTo: created.assignedTo ?? "",
      condition: "Updated",
      qty: 7,
      serialNumber: created.serialNumber ?? "",
    });

    expect(updated.qty).toBe(7);
    expect(updated.condition).toBe("Updated");

    const verified = inventoryDb.toggleVerifiedRecord(runtimeContext, created.id, true);
    expect(verified.verifiedInSurvey).toBe(true);

    const archived = inventoryDb.setArchivedRecord(runtimeContext, created.id, true);
    expect(archived.archived).toBe(true);

    const deletion = inventoryDb.deleteInventoryRecord(runtimeContext, created.id);
    expect(deletion.recordId).toBe(created.id);
    expect(inventoryDb.loadInventoryRecords(runtimeContext).records).toHaveLength(initialRecords);
  });
});
