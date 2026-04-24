import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SHARED_SYNC_INTERVAL_MS,
  ensureInventorySchema,
  resolveDbPath,
  resolveSharedDbPath,
  resolveSharedDirectoryPath,
  resolveLegacySharedDbPath,
  resolveSharedRootPath,
} from "./inventory-runtime.mjs";

const SHARED_UNAVAILABLE_MESSAGE = "Shared workspace unavailable. Saving changes locally.";
const SHARED_BUSY_MESSAGE = "Shared workspace busy, retry in a moment.";
const SHARED_CONNECTED_MESSAGE = "Shared workspace connected.";
const LOCAL_MUTATION_MARKER = "local_mutation";
const SHARED_SYNC_MARKER = "shared_sync";

const SELECT_FIELDS = `
  entry_id,
  entry_uuid,
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
const SELECT_SQL = `SELECT ${SELECT_FIELDS} FROM entries ORDER BY updated_at DESC, entry_id DESC`;
let lastNoChangeSyncKey = "";

export function loadInventoryEntries(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);
  return {
    dbPath,
    entries: loadInventoryEntriesFromPath(dbPath),
    shared: getSharedInventoryStatus(dbPath),
  };
}

export function syncInventoryWithShared(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);

  try {
    const sharedDbPath = ensureSharedDatabase(dbPath);
    const localRevision = ensureNumericRevision(dbPath, "local_sync_check");
    const sharedRevision = ensureNumericRevision(sharedDbPath, "shared_sync_check");

    if (localRevision > sharedRevision) {
      replaceDatabaseFile(dbPath, sharedDbPath);
      setRevisionForPath(sharedDbPath, localRevision, SHARED_SYNC_MARKER);
      setRevisionForPath(dbPath, localRevision, SHARED_SYNC_MARKER);
      return {
        dbPath,
        entries: [],
        entriesChanged: false,
        shared: buildSharedStatus({
          available: true,
          canModify: true,
          message: SHARED_CONNECTED_MESSAGE,
          mutationMode: "shared",
          revision: localRevision,
          sharedDbPath,
        }),
      };
    }

    if (sharedRevision > localRevision) {
      replaceDatabaseFile(sharedDbPath, dbPath);
      return {
        dbPath,
        entries: loadInventoryEntriesFromPath(dbPath),
        entriesChanged: true,
        shared: buildSharedStatus({
          available: true,
          canModify: true,
          message: SHARED_CONNECTED_MESSAGE,
          mutationMode: "shared",
          revision: sharedRevision,
          sharedDbPath,
        }),
      };
    }

    if (entryDataMatchesForEqualRevision(dbPath, sharedDbPath, localRevision)) {
      return {
        dbPath,
        entries: [],
        entriesChanged: false,
        shared: buildSharedStatus({
          available: true,
          canModify: true,
          message: SHARED_CONNECTED_MESSAGE,
          mutationMode: "shared",
          revision: localRevision,
          sharedDbPath,
        }),
      };
    }

    replaceDatabaseFile(sharedDbPath, dbPath);

    return {
      dbPath,
      entries: loadInventoryEntriesFromPath(dbPath),
      entriesChanged: true,
      shared: buildSharedStatus({
        available: true,
        canModify: true,
        message: SHARED_CONNECTED_MESSAGE,
        mutationMode: "shared",
        revision: sharedRevision,
        sharedDbPath,
      }),
    };
  } catch (error) {
    return {
      dbPath,
      entries: loadInventoryEntriesFromPath(dbPath),
      entriesChanged: true,
      shared: buildUnavailableSharedStatus(error, dbPath),
    };
  }
}

export function getSharedInventoryStatus(localDbPath = "") {
  const sharedRootPath = resolveSharedRootPath();
  const sharedDbPath = resolveSharedDbPath();
  const legacySharedDbPath = resolveLegacySharedDbPath();

  if (!sharedRootPath) {
    return buildLocalSharedStatus("Shared workspace path is not configured. Saving changes locally.", localDbPath);
  }

  if (!fs.existsSync(sharedRootPath)) {
    return buildLocalSharedStatus(SHARED_UNAVAILABLE_MESSAGE, localDbPath);
  }

  return buildSharedStatus({
    available: true,
    canModify: true,
    message: fs.existsSync(sharedDbPath)
      ? SHARED_CONNECTED_MESSAGE
      : fs.existsSync(legacySharedDbPath)
        ? "Shared workspace connected; legacy shared database will be migrated."
      : "Shared workspace connected; shared database will be initialized.",
    mutationMode: "shared",
    sharedDbPath,
  });
}

export function createInventoryEntry(runtimeContext, entryInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const entry = normalizeEntryInput(entryInput);
  const entryUuid = randomUUID();

  validateEntryInput(entry);

  runEntryMutationWithSharedFallback(dbPath, (db) => {
    db.prepare(
      `
        INSERT INTO entries (
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
          entry_uuid,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
      `,
    ).run(
      entry.assetNumber,
      entry.serialNumber,
      entry.manufacturer,
      entry.manufacturer,
      entry.model,
      entry.description,
      entry.qty,
      entry.location,
      entry.assignedTo,
      entry.lifecycleStatus,
      entry.workingStatus,
      entry.condition,
      entry.projectName,
      entry.links,
      entry.notes,
      entry.verifiedInSurvey ? 1 : 0,
      entry.archived ? 1 : 0,
      entry.picturePath,
      entryUuid,
    );
  });

  return selectEntryByUuidFromPath(dbPath, entryUuid);
}

export function toggleVerifiedEntry(runtimeContext, entryId, nextVerified) {
  const dbPath = resolveDbPath(runtimeContext);
  const selector = resolveEntrySelector(dbPath, entryId);

  runEntryMutationWithSharedFallback(dbPath, (db) => {
    db.prepare(
      `
        UPDATE entries
        SET verified_in_survey = ?, updated_at = datetime('now')
        WHERE ${selector.whereSql}
      `,
    ).run(nextVerified ? 1 : 0, selector.value);
  });

  return selectEntryBySelectorFromPath(dbPath, selector);
}

export function updateInventoryEntry(runtimeContext, entryId, entryInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const selector = resolveEntrySelector(dbPath, entryId);
  const entry = normalizeEntryInput(entryInput);

  validateEntryInput(entry);

  runEntryMutationWithSharedFallback(dbPath, (db) => {
    db.prepare(
      `
        UPDATE entries
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
      entry.assetNumber,
      entry.serialNumber,
      entry.manufacturer,
      entry.manufacturer,
      entry.model,
      entry.description,
      entry.qty,
      entry.location,
      entry.assignedTo,
      entry.lifecycleStatus,
      entry.workingStatus,
      entry.condition,
      entry.projectName,
      entry.links,
      entry.notes,
      entry.verifiedInSurvey ? 1 : 0,
      entry.archived ? 1 : 0,
      entry.picturePath,
      selector.value,
    );
  });

  return selectEntryBySelectorFromPath(dbPath, selector);
}

export function setArchivedEntry(runtimeContext, entryId, archived) {
  const dbPath = resolveDbPath(runtimeContext);
  const selector = resolveEntrySelector(dbPath, entryId);

  runEntryMutationWithSharedFallback(dbPath, (db) => {
    db.prepare(
      `
        UPDATE entries
        SET is_archived = ?, updated_at = datetime('now')
        WHERE ${selector.whereSql}
      `,
    ).run(archived ? 1 : 0, selector.value);
  });

  return selectEntryBySelectorFromPath(dbPath, selector);
}

export function deleteInventoryEntry(runtimeContext, entryId) {
  const dbPath = resolveDbPath(runtimeContext);
  const selector = resolveEntrySelector(dbPath, entryId);

  runEntryMutationWithSharedFallback(dbPath, (db) => {
    db.prepare(`DELETE FROM entries WHERE ${selector.whereSql}`).run(selector.value);
  });

  return { entryId: String(entryId) };
}

function loadInventoryEntriesFromPath(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const rows = db.prepare(SELECT_SQL).all();
    return rows.map(mapEntryRow);
  } finally {
    db.close();
  }
}

function runEntryMutationWithSharedFallback(localDbPath, mutate) {
  try {
    const sharedDbPath = ensureSharedDatabase(localDbPath);
    runSharedMutation(sharedDbPath, mutate);
    replaceDatabaseFile(sharedDbPath, localDbPath);
    return { mutationMode: "shared", sharedDbPath };
  } catch (error) {
    if (!isSharedSetupUnavailableError(error)) {
      throw error;
    }

    runLocalMutation(localDbPath, mutate);
    return { mutationMode: "local", sharedDbPath: resolveSharedDbPath() };
  }
}

function ensureSharedDatabase(localDbPath) {
  const sharedRootPath = resolveSharedRootPath();
  const sharedDirectoryPath = resolveSharedDirectoryPath();
  const sharedDbPath = resolveSharedDbPath();
  const legacySharedDbPath = resolveLegacySharedDbPath();

  if (!sharedRootPath || !sharedDirectoryPath || !sharedDbPath) {
    throw new Error("Shared workspace path is not configured.");
  }

  if (!fs.existsSync(sharedRootPath)) {
    throw new Error(SHARED_UNAVAILABLE_MESSAGE);
  }

  fs.mkdirSync(sharedDirectoryPath, { recursive: true });

  if (!fs.existsSync(sharedDbPath) && fs.existsSync(legacySharedDbPath)) {
    replaceDatabaseFile(legacySharedDbPath, sharedDbPath);
  }

  ensureInventorySchema(localDbPath);
  if (fs.existsSync(sharedDbPath)) {
    ensureInventorySchema(sharedDbPath);
  }

  const shouldBootstrap =
    !fs.existsSync(sharedDbPath) ||
    (getEntryCount(sharedDbPath) === 0 && getEntryCount(localDbPath) > 0);

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
    clearNoChangeSyncCache();
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

function runLocalMutation(localDbPath, mutate) {
  ensureInventorySchema(localDbPath);
  const db = new DatabaseSync(localDbPath);

  try {
    db.exec("PRAGMA journal_mode=DELETE");
    db.exec("PRAGMA synchronous=FULL");
    db.exec("BEGIN IMMEDIATE");
    mutate(db);
    incrementLocalRevision(db);
    db.exec("COMMIT");
    clearNoChangeSyncCache();
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors when SQLite already closed the transaction.
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

  clearNoChangeSyncCache();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  removeSqliteSidecars(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
  removeSqliteSidecars(targetPath);
}

function clearNoChangeSyncCache() {
  lastNoChangeSyncKey = "";
}

function entryDataMatchesForEqualRevision(localDbPath, sharedDbPath, revision) {
  if (isSamePath(localDbPath, sharedDbPath)) {
    return true;
  }

  const syncKey = buildEqualRevisionSyncKey(localDbPath, sharedDbPath, revision);
  if (syncKey && syncKey === lastNoChangeSyncKey) {
    return true;
  }

  const matches = getEntryDataFingerprint(localDbPath) === getEntryDataFingerprint(sharedDbPath);
  lastNoChangeSyncKey = matches && syncKey ? syncKey : "";
  return matches;
}

function buildEqualRevisionSyncKey(localDbPath, sharedDbPath, revision) {
  try {
    const localStat = fs.statSync(localDbPath);
    const sharedStat = fs.statSync(sharedDbPath);
    return [
      path.resolve(localDbPath).toLowerCase(),
      path.resolve(sharedDbPath).toLowerCase(),
      revision,
      localStat.size,
      localStat.mtimeMs,
      sharedStat.size,
      sharedStat.mtimeMs,
    ].join("|");
  } catch {
    return "";
  }
}

function getEntryDataFingerprint(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const rows = db.prepare(`SELECT ${SELECT_FIELDS} FROM entries ORDER BY entry_uuid, entry_id`).all();
    const hash = createHash("sha256");
    for (const row of rows) {
      hash.update(JSON.stringify(row));
      hash.update("\n");
    }
    return hash.digest("hex");
  } finally {
    db.close();
  }
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

function getEntryCount(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return 0;
  }

  ensureInventorySchema(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries' LIMIT 1")
      .get();
    if (!tableRow) {
      return 0;
    }
    const countRow = db.prepare("SELECT COUNT(*) AS count FROM entries").get();
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

function setRevisionForPath(dbPath, revision, updatedBy) {
  const db = new DatabaseSync(dbPath);

  try {
    setRevision(db, revision, updatedBy);
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

  const entryCount = Number(db.prepare("SELECT COUNT(*) AS count FROM entries").get()?.count ?? 0);
  const normalizedRevision = entryCount > 0 ? 1 : 0;
  setRevision(db, normalizedRevision, updatedBy);
  return normalizedRevision;
}

function incrementSharedRevision(db) {
  const currentRevision = ensureNumericRevisionForDb(db, "mutation");
  const nextRevision = currentRevision + 1;
  setRevision(db, nextRevision, "ME Inventory");
  return nextRevision;
}

function incrementLocalRevision(db) {
  const currentRevision = ensureNumericRevisionForDb(db, LOCAL_MUTATION_MARKER);
  const nextRevision = currentRevision + 1;
  setRevision(db, nextRevision, LOCAL_MUTATION_MARKER);
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

function isSharedSetupUnavailableError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === SHARED_UNAVAILABLE_MESSAGE ||
    error.message === "Shared workspace path is not configured."
  );
}

function resolveEntrySelector(dbPath, entryId) {
  const numericEntryId = parseEntryId(entryId);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare("SELECT entry_uuid FROM entries WHERE entry_id = ? LIMIT 1").get(numericEntryId);
    const entryUuid = String(row?.entry_uuid ?? "").trim();
    if (entryUuid) {
      return {
        value: entryUuid,
        whereSql: "entry_uuid = ?",
        type: "uuid",
      };
    }
  } finally {
    db.close();
  }

  return {
    value: numericEntryId,
    whereSql: "entry_id = ?",
    type: "id",
  };
}

function selectEntryByUuidFromPath(dbPath, entryUuid) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare(`SELECT ${SELECT_FIELDS} FROM entries WHERE entry_uuid = ? LIMIT 1`).get(entryUuid);
    if (!row) {
      throw new Error("Entry not found after database update.");
    }
    return mapEntryRow(row);
  } finally {
    db.close();
  }
}

function selectEntryBySelectorFromPath(dbPath, selector) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare(`SELECT ${SELECT_FIELDS} FROM entries WHERE ${selector.whereSql} LIMIT 1`).get(selector.value);
    if (!row) {
      throw new Error("Entry not found after database update.");
    }
    return mapEntryRow(row);
  } finally {
    db.close();
  }
}

function buildUnavailableSharedStatus(error, localDbPath = "") {
  const message = error instanceof Error && error.message ? error.message : SHARED_UNAVAILABLE_MESSAGE;
  if (isSharedSetupUnavailableError(error)) {
    return buildLocalSharedStatus(
      message === "Shared workspace path is not configured."
        ? "Shared workspace path is not configured. Saving changes locally."
        : SHARED_UNAVAILABLE_MESSAGE,
      localDbPath,
    );
  }

  return buildSharedStatus({
    available: false,
    canModify: false,
    message,
    mutationMode: "local",
    sharedDbPath: resolveSharedDbPath(),
  });
}

function buildLocalSharedStatus(message, localDbPath) {
  const revisionInfo = getRevisionInfo(localDbPath);

  return buildSharedStatus({
    available: false,
    canModify: true,
    hasLocalOnlyChanges: revisionInfo.updatedBy === LOCAL_MUTATION_MARKER,
    message,
    mutationMode: "local",
    revision: revisionInfo.revision,
    sharedDbPath: resolveSharedDbPath(),
  });
}

function buildSharedStatus({
  available,
  canModify,
  hasLocalOnlyChanges = false,
  message,
  mutationMode = available ? "shared" : "local",
  revision = 0,
  sharedDbPath = resolveSharedDbPath(),
}) {
  return {
    available,
    canModify,
    enabled: true,
    hasLocalOnlyChanges,
    message,
    mutationMode,
    revision: String(revision || ""),
    sharedDbPath,
    sharedRootPath: resolveSharedRootPath(),
    syncIntervalMs: SHARED_SYNC_INTERVAL_MS,
  };
}

function getRevisionInfo(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { revision: 0, updatedBy: "" };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const row = db.prepare("SELECT revision, global_mutation_at FROM sync_state WHERE id = 1 LIMIT 1").get();
    return {
      revision: parseRevision(row?.revision),
      updatedBy: String(row?.global_mutation_at ?? ""),
    };
  } finally {
    db.close();
  }
}

function mapEntryRow(row) {
  return {
    id: String(row.entry_id ?? ""),
    entryUuid: String(row.entry_uuid ?? ""),
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

function parseEntryId(entryId) {
  const numericEntryId = Number(entryId);
  if (!Number.isInteger(numericEntryId)) {
    throw new Error("Invalid database entry id.");
  }
  return numericEntryId;
}

function normalizeEntryInput(entryInput) {
  return {
    assetNumber: normalizeText(entryInput?.assetNumber),
    serialNumber: normalizeText(entryInput?.serialNumber),
    qty: normalizeQty(entryInput?.qty),
    manufacturer: normalizeText(entryInput?.manufacturer),
    model: normalizeText(entryInput?.model),
    description: normalizeText(entryInput?.description),
    projectName: normalizeText(entryInput?.projectName),
    location: normalizeText(entryInput?.location),
    assignedTo: normalizeText(entryInput?.assignedTo),
    links: normalizeText(entryInput?.links),
    notes: normalizeText(entryInput?.notes),
    lifecycleStatus: normalizeEnum(entryInput?.lifecycleStatus, ["active", "repair", "scrapped", "missing", "rental"], "active"),
    workingStatus: normalizeEnum(entryInput?.workingStatus, ["unknown", "working", "limited", "not_working"], "unknown"),
    condition: normalizeText(entryInput?.condition),
    verifiedInSurvey: Boolean(entryInput?.verifiedInSurvey),
    archived: Boolean(entryInput?.archived),
    picturePath: normalizeText(entryInput?.picturePath),
  };
}

function validateEntryInput(entry) {
  if (!entry.assetNumber && !entry.serialNumber && !entry.manufacturer && !entry.model && !entry.description) {
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
