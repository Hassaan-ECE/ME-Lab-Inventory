import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DB_FILENAME = "me_lab_inventory.db";
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
const SELECT_BY_ID_SQL = `SELECT ${SELECT_FIELDS} FROM equipment WHERE record_id = ? LIMIT 1`;

export function loadInventoryRecords(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const rows = db.prepare(SELECT_SQL).all();
    return {
      dbPath,
      records: rows.map(mapEquipmentRow),
    };
  } finally {
    db.close();
  }
}

export function createInventoryRecord(runtimeContext, recordInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const db = new DatabaseSync(dbPath);
  const record = normalizeRecordInput(recordInput);

  validateRecordInput(record);

  try {
    const result = db
      .prepare(
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, datetime('now'), datetime('now'))
        `,
      )
      .run(
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
        randomUUID(),
      );

    return selectRecordById(db, result.lastInsertRowid);
  } finally {
    db.close();
  }
}

export function toggleVerifiedRecord(runtimeContext, recordId, nextVerified) {
  const dbPath = resolveDbPath(runtimeContext);
  const numericRecordId = parseRecordId(recordId);

  const db = new DatabaseSync(dbPath);

  try {
    db.prepare(
      `
        UPDATE equipment
        SET verified_in_survey = ?, updated_at = datetime('now')
        WHERE record_id = ?
      `,
    ).run(nextVerified ? 1 : 0, numericRecordId);

    return selectRecordById(db, numericRecordId);
  } finally {
    db.close();
  }
}

export function updateInventoryRecord(runtimeContext, recordId, recordInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const numericRecordId = parseRecordId(recordId);
  const db = new DatabaseSync(dbPath);
  const record = normalizeRecordInput(recordInput);

  validateRecordInput(record);

  try {
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
          updated_at = datetime('now')
        WHERE record_id = ?
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
      numericRecordId,
    );

    return selectRecordById(db, numericRecordId);
  } finally {
    db.close();
  }
}

export function setArchivedRecord(runtimeContext, recordId, archived) {
  const dbPath = resolveDbPath(runtimeContext);
  const numericRecordId = parseRecordId(recordId);
  const db = new DatabaseSync(dbPath);

  try {
    db.prepare(
      `
        UPDATE equipment
        SET is_archived = ?, updated_at = datetime('now')
        WHERE record_id = ?
      `,
    ).run(archived ? 1 : 0, numericRecordId);

    return selectRecordById(db, numericRecordId);
  } finally {
    db.close();
  }
}

export function deleteInventoryRecord(runtimeContext, recordId) {
  const dbPath = resolveDbPath(runtimeContext);
  const numericRecordId = parseRecordId(recordId);
  const db = new DatabaseSync(dbPath);

  try {
    db.prepare("DELETE FROM equipment WHERE record_id = ?").run(numericRecordId);
    return { recordId: String(numericRecordId) };
  } finally {
    db.close();
  }
}

function resolveDbPath({ appPath, isPackaged, resourcesPath, userDataPath }) {
  if (!isPackaged) {
    const developmentCandidates = [
      path.join(appPath, "data", DB_FILENAME),
      path.join(path.dirname(appPath), "data", DB_FILENAME),
      path.join(process.cwd(), "data", DB_FILENAME),
    ];

    for (const candidatePath of developmentCandidates) {
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    throw new Error("No development database was found in the project data directory.");
  }

  const bundledSeedPath = path.join(resourcesPath, "data", DB_FILENAME);
  const runtimeDataDir = path.join(userDataPath, "data");
  const runtimeDbPath = path.join(runtimeDataDir, DB_FILENAME);

  fs.mkdirSync(runtimeDataDir, { recursive: true });
  if (!fs.existsSync(runtimeDbPath)) {
    if (!fs.existsSync(bundledSeedPath)) {
      throw new Error("Bundled database seed is missing.");
    }
    fs.copyFileSync(bundledSeedPath, runtimeDbPath);
  }

  return runtimeDbPath;
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

function selectRecordById(db, recordId) {
  const row = db.prepare(SELECT_BY_ID_SQL).get(recordId);
  if (!row) {
    throw new Error("Record not found after database update.");
  }
  return mapEquipmentRow(row);
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
