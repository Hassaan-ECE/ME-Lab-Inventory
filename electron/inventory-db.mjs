import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SHARED_SYNC_INTERVAL_MS,
  resolveDbPath,
  resolveSharedDbPath,
  resolveSharedDirectoryPath,
  resolveSharedRootPath,
} from "./inventory-runtime.mjs";

const SHARED_UNAVAILABLE_MESSAGE = "Shared workspace unavailable. Viewing local cache only.";
const SHARED_BUSY_MESSAGE = "Shared workspace busy, retry in a moment.";
const SHARED_CONNECTED_MESSAGE = "Shared workspace connected.";

const SELECT_FIELDS = `
  record_id,
  record_uuid,
  asset_number,
  serial_number,
  qty,
  manufacturer,
  model,
  description,
  project_name,
  location,
  assigned_to,
  links,
  notes,
  lifecycle_status,
  working_status,
  condition,
  verified_in_survey,
  is_archived,
  manual_entry,
  picture_path,
  created_at,
  updated_at
`;
const SELECT_SQL = `SELECT ${SELECT_FIELDS} FROM equipment ORDER BY updated_at DESC, record_id DESC`;

export function loadInventoryRecords(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);
  return {
    dbPath,
    records: loadInventoryRecordsFromPath(dbPath),
    shared: getSharedInventoryStatus(),
  };
}

export function syncInventoryWithShared(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);

  try {
    const sharedDbPath = ensureSharedDatabase(dbPath);
    replaceDatabaseFile(sharedDbPath, dbPath);
    const revision = ensureNumericRevision(dbPath, "local_sync");

    return {
      dbPath,
      records: loadInventoryRecordsFromPath(dbPath),
      shared: buildSharedStatus({
        available: true,
        canModify: true,
        message: SHARED_CONNECTED_MESSAGE,
        revision,
        sharedDbPath,
      }),
    };
  } catch (error) {
    return {
      dbPath,
      records: loadInventoryRecordsFromPath(dbPath),
      shared: buildUnavailableSharedStatus(error),
    };
  }
}

export function getSharedInventoryStatus() {
  const sharedRootPath = resolveSharedRootPath();
  const sharedDbPath = resolveSharedDbPath();

  if (!sharedRootPath) {
    return buildSharedStatus({
      available: false,
      canModify: false,
      message: "Shared workspace path is not configured.",
      sharedDbPath,
    });
  }

  if (!fs.existsSync(sharedRootPath)) {
    return buildSharedStatus({
      available: false,
      canModify: false,
      message: SHARED_UNAVAILABLE_MESSAGE,
      sharedDbPath,
    });
  }

  return buildSharedStatus({
    available: true,
    canModify: true,
    message: fs.existsSync(sharedDbPath)
      ? SHARED_CONNECTED_MESSAGE
      : "Shared workspace connected; shared database will be initialized.",
    sharedDbPath,
  });
}

export function createInventoryRecord(runtimeContext, recordInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const sharedDbPath = ensureSharedDatabase(dbPath);
  const record = normalizeRecordInput(recordInput);
  const recordUuid = randomUUID();

  validateRecordInput(record);

  runSharedMutation(sharedDbPath, (db) => {
    db.prepare(
      `
        INSERT INTO equipment (
          asset_number,
          serial_number,
          manufacturer,
          manufacturer_raw,
          model,
          description,
          qty,
          location,
          assigned_to,
          lifecycle_status,
          working_status,
          condition,
          project_name,
          links,
          notes,
          verified_in_survey,
          is_archived,
          manual_entry,
          picture_path,
          record_uuid,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
      `,
    ).run(
      record.assetNumber,
      record.serialNumber,
      record.manufacturer,
      record.manufacturer,
      record.model,
      record.description,
      record.qty,
      record.location,
      record.assignedTo,
      record.lifecycleStatus,
      record.workingStatus,
      record.condition,
      record.projectName,
      record.links,
      record.notes,
      record.verifiedInSurvey ? 1 : 0,
      record.archived ? 1 : 0,
      record.picturePath,
      recordUuid,
    );
  });

  replaceDatabaseFile(sharedDbPath, dbPath);
  return selectRecordByUuidFromPath(dbPath, recordUuid);
}

export function toggleVerifiedRecord(runtimeContext, recordId, nextVerified) {
  const dbPath = resolveDbPath(runtimeContext);
  const sharedDbPath = ensureSharedDatabase(dbPath);
  const selector = resolveRecordSelector(dbPath, recordId);

  runSharedMutation(sharedDbPath, (db) => {
    db.prepare(
      `
        UPDATE equipment
        SET verified_in_survey = ?, updated_at = datetime('now')
        WHERE ${selector.whereSql}
      `,
    ).run(nextVerified ? 1 : 0, selector.value);
  });

  replaceDatabaseFile(sharedDbPath, dbPath);
  return selectRecordBySelectorFromPath(dbPath, selector);
}

export function updateInventoryRecord(runtimeContext, recordId, recordInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const sharedDbPath = ensureSharedDatabase(dbPath);
  const selector = resolveRecordSelector(dbPath, recordId);
  const record = normalizeRecordInput(recordInput);

  validateRecordInput(record);

  runSharedMutation(sharedDbPath, (db) => {
    db.prepare(
      `
        UPDATE equipment
        SET
          asset_number = ?,
          serial_number = ?,
          manufacturer = ?,
          manufacturer_raw = ?,
          model = ?,
          description = ?,
          qty = ?,
          location = ?,
          assigned_to = ?,
          lifecycle_status = ?,
          working_status = ?,
          condition = ?,
          project_name = ?,
          links = ?,
          notes = ?,
          verified_in_survey = ?,
          is_archived = ?,
          picture_path = ?,
          updated_at = datetime('now')
        WHERE ${selector.whereSql}
      `,
    ).run(
      record.assetNumber,
      record.serialNumber,
      record.manufacturer,
      record.manufacturer,
      record.model,
      record.description,
      record.qty,
      record.location,
      record.assignedTo,
      record.lifecycleStatus,
      record.workingStatus,
      record.condition,
      record.projectName,
      record.links,
      record.notes,
      record.verifiedInSurvey ? 1 : 0,
      record.archived ? 1 : 0,
      record.picturePath,
      selector.value,
    );
  });

  replaceDatabaseFile(sharedDbPath, dbPath);
  return selectRecordBySelectorFromPath(dbPath, selector);
}

export function setArchivedRecord(runtimeContext, recordId, archived) {
  const dbPath = resolveDbPath(runtimeContext);
  const sharedDbPath = ensureSharedDatabase(dbPath);
  const selector = resolveRecordSelector(dbPath, recordId);

  runSharedMutation(sharedDbPath, (db) => {
    db.prepare(
      `
        UPDATE equipment
        SET is_archived = ?, updated_at = datetime('now')
        WHERE ${selector.whereSql}
      `,
    ).run(archived ? 1 : 0, selector.value);
  });

  replaceDatabaseFile(sharedDbPath, dbPath);
  return selectRecordBySelectorFromPath(dbPath, selector);
}

export function deleteInventoryRecord(runtimeContext, recordId) {
  const dbPath = resolveDbPath(runtimeContext);
  const sharedDbPath = ensureSharedDatabase(dbPath);
  const selector = resolveRecordSelector(dbPath, recordId);

  runSharedMutation(sharedDbPath, (db) => {
    db.prepare(`DELETE FROM equipment WHERE ${selector.whereSql}`).run(selector.value);
  });

  replaceDatabaseFile(sharedDbPath, dbPath);
  return { recordId: String(recordId) };
}

function loadInventoryRecordsFromPath(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const rows = db.prepare(SELECT_SQL).all();
    return rows.map(mapEquipmentRow);
  } finally {
    db.close();
  }
}

function ensureSharedDatabase(localDbPath) {
  const sharedRootPath = resolveSharedRootPath();
  const sharedDirectoryPath = resolveSharedDirectoryPath();
  const sharedDbPath = resolveSharedDbPath();

  if (!sharedRootPath || !sharedDirectoryPath || !sharedDbPath) {
    throw new Error("Shared workspace path is not configured.");
  }

  if (!fs.existsSync(sharedRootPath)) {
    throw new Error(SHARED_UNAVAILABLE_MESSAGE);
  }

  fs.mkdirSync(sharedDirectoryPath, { recursive: true });

  const shouldBootstrap =
    !fs.existsSync(sharedDbPath) ||
    (getEquipmentCount(sharedDbPath) === 0 && getEquipmentCount(localDbPath) > 0);

  if (shouldBootstrap) {
    replaceDatabaseFile(localDbPath, sharedDbPath);
  }

  ensureNumericRevision(sharedDbPath, "shared_bootstrap");
  return sharedDbPath;
}

function runSharedMutation(sharedDbPath, mutate) {
  const db = new DatabaseSync(sharedDbPath);

  try {
    db.exec("PRAGMA journal_mode=DELETE");
    db.exec("PRAGMA synchronous=FULL");
    db.exec("PRAGMA busy_timeout = 2000");
    db.exec("BEGIN IMMEDIATE");
    mutate(db);
    incrementSharedRevision(db);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors when SQLite already closed the transaction.
    }

    if (error instanceof Error && /busy|locked/i.test(error.message)) {
      throw new Error(SHARED_BUSY_MESSAGE);
    }

    throw error;
  } finally {
    db.close();
  }
}

function replaceDatabaseFile(sourcePath, targetPath) {
  if (isSamePath(sourcePath, targetPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  removeSqliteSidecars(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
  removeSqliteSidecars(targetPath);
}

function removeSqliteSidecars(dbPath) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function isSamePath(leftPath, rightPath) {
  return path.resolve(leftPath).toLowerCase() === path.resolve(rightPath).toLowerCase();
}

function getEquipmentCount(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return 0;
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'equipment' LIMIT 1")
      .get();
    if (!tableRow) {
      return 0;
    }
    const countRow = db.prepare("SELECT COUNT(*) AS count FROM equipment").get();
    return Number(countRow?.count ?? 0);
  } finally {
    db.close();
  }
}

function ensureNumericRevision(dbPath, updatedBy) {
  const db = new DatabaseSync(dbPath);

  try {
    return ensureNumericRevisionForDb(db, updatedBy);
  } finally {
    db.close();
  }
}

function ensureNumericRevisionForDb(db, updatedBy) {
  const row = db.prepare("SELECT revision FROM sync_state WHERE id = 1 LIMIT 1").get();
  const revision = parseRevision(row?.revision);
  if (String(row?.revision ?? "").trim() === String(revision)) {
    return revision;
  }

  const recordCount = Number(db.prepare("SELECT COUNT(*) AS count FROM equipment").get()?.count ?? 0);
  const normalizedRevision = recordCount > 0 ? 1 : 0;
  setRevision(db, normalizedRevision, updatedBy);
  return normalizedRevision;
}

function incrementSharedRevision(db) {
  const currentRevision = ensureNumericRevisionForDb(db, "mutation");
  const nextRevision = currentRevision + 1;
  setRevision(db, nextRevision, "ME Lab Inventory");
  return nextRevision;
}

function setRevision(db, revision, updatedBy) {
  db.prepare(
    `
      INSERT INTO sync_state (id, revision, global_mutation_at, updated_at)
      VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        revision = excluded.revision,
        global_mutation_at = excluded.global_mutation_at,
        updated_at = datetime('now')
    `,
  ).run(String(Math.max(0, Number(revision) || 0)), String(updatedBy ?? ""));
}

function parseRevision(value) {
  const revision = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

function resolveRecordSelector(dbPath, recordId) {
  const numericRecordId = parseRecordId(recordId);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare("SELECT record_uuid FROM equipment WHERE record_id = ? LIMIT 1").get(numericRecordId);
    const recordUuid = String(row?.record_uuid ?? "").trim();
    if (recordUuid) {
      return {
        value: recordUuid,
        whereSql: "record_uuid = ?",
        type: "uuid",
      };
    }
  } finally {
    db.close();
  }

  return {
    value: numericRecordId,
    whereSql: "record_id = ?",
    type: "id",
  };
}

function selectRecordByUuidFromPath(dbPath, recordUuid) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare(`SELECT ${SELECT_FIELDS} FROM equipment WHERE record_uuid = ? LIMIT 1`).get(recordUuid);
    if (!row) {
      throw new Error("Record not found after database update.");
    }
    return mapEquipmentRow(row);
  } finally {
    db.close();
  }
}

function selectRecordBySelectorFromPath(dbPath, selector) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare(`SELECT ${SELECT_FIELDS} FROM equipment WHERE ${selector.whereSql} LIMIT 1`).get(selector.value);
    if (!row) {
      throw new Error("Record not found after database update.");
    }
    return mapEquipmentRow(row);
  } finally {
    db.close();
  }
}

function buildUnavailableSharedStatus(error) {
  const message = error instanceof Error && error.message ? error.message : SHARED_UNAVAILABLE_MESSAGE;
  return buildSharedStatus({
    available: false,
    canModify: false,
    message,
    sharedDbPath: resolveSharedDbPath(),
  });
}

function buildSharedStatus({
  available,
  canModify,
  message,
  revision = 0,
  sharedDbPath = resolveSharedDbPath(),
}) {
  return {
    available,
    canModify,
    enabled: true,
    message,
    revision: String(revision || ""),
    sharedDbPath,
    sharedRootPath: resolveSharedRootPath(),
    syncIntervalMs: SHARED_SYNC_INTERVAL_MS,
  };
}

function mapEquipmentRow(row) {
  return {
    id: String(row.record_id ?? ""),
    recordUuid: String(row.record_uuid ?? ""),
    assetNumber: String(row.asset_number ?? ""),
    serialNumber: String(row.serial_number ?? ""),
    qty: row.qty == null ? null : Number(row.qty),
    manufacturer: String(row.manufacturer ?? ""),
    model: String(row.model ?? ""),
    description: String(row.description ?? ""),
    projectName: String(row.project_name ?? ""),
    location: String(row.location ?? ""),
    assignedTo: String(row.assigned_to ?? ""),
    links: String(row.links ?? ""),
    notes: String(row.notes ?? ""),
    lifecycleStatus: String(row.lifecycle_status ?? "active"),
    workingStatus: String(row.working_status ?? "unknown"),
    condition: String(row.condition ?? ""),
    verifiedInSurvey: Boolean(row.verified_in_survey),
    archived: Boolean(row.is_archived),
    manualEntry: Boolean(row.manual_entry),
    picturePath: String(row.picture_path ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function parseRecordId(recordId) {
  const numericRecordId = Number(recordId);
  if (!Number.isInteger(numericRecordId)) {
    throw new Error("Invalid database record id.");
  }
  return numericRecordId;
}

function normalizeRecordInput(recordInput) {
  return {
    assetNumber: normalizeText(recordInput?.assetNumber),
    serialNumber: normalizeText(recordInput?.serialNumber),
    qty: normalizeQty(recordInput?.qty),
    manufacturer: normalizeText(recordInput?.manufacturer),
    model: normalizeText(recordInput?.model),
    description: normalizeText(recordInput?.description),
    projectName: normalizeText(recordInput?.projectName),
    location: normalizeText(recordInput?.location),
    assignedTo: normalizeText(recordInput?.assignedTo),
    links: normalizeText(recordInput?.links),
    notes: normalizeText(recordInput?.notes),
    lifecycleStatus: normalizeEnum(recordInput?.lifecycleStatus, ["active", "repair", "scrapped", "missing", "rental"], "active"),
    workingStatus: normalizeEnum(recordInput?.workingStatus, ["unknown", "working", "limited", "not_working"], "unknown"),
    condition: normalizeText(recordInput?.condition),
    verifiedInSurvey: Boolean(recordInput?.verifiedInSurvey),
    archived: Boolean(recordInput?.archived),
    picturePath: normalizeText(recordInput?.picturePath),
  };
}

function validateRecordInput(record) {
  if (!record.assetNumber && !record.serialNumber && !record.manufacturer && !record.model && !record.description) {
    throw new Error("Provide at least an asset number, serial number, manufacturer, model, or description.");
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQty(value) {
  if (value == null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeEnum(value, allowedValues, fallbackValue) {
  return allowedValues.includes(value) ? value : fallbackValue;
}
