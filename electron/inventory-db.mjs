import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SHARED_SYNC_INTERVAL_MS,
  ensureInventorySchema,
  resolveDbPath,
  resolveLegacySharedDbPath,
  resolveSharedDbPath,
  resolveSharedDirectoryPath,
  resolveSharedRootPath,
} from "./inventory-runtime.mjs";

const SHARED_UNAVAILABLE_MESSAGE = "Shared workspace unavailable. Saving changes locally.";
const SHARED_BUSY_MESSAGE = "Shared workspace busy. Changes are saved locally and will sync later.";
const SHARED_CONNECTED_MESSAGE = "Shared workspace connected.";
const LOCAL_MUTATION_MESSAGE = "Changes saved locally. Sync pending.";
const LOCAL_MUTATION_MARKER = "local_mutation";
const SHARED_SYNC_MARKER = "shared_sync";
const MAX_QUERY_LIMIT = 100_000;

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

const ENTRY_COLUMNS = [
  "entry_uuid",
  "asset_number",
  "serial_number",
  "manufacturer",
  "manufacturer_raw",
  "model",
  "description",
  "qty",
  "location",
  "assigned_to",
  "lifecycle_status",
  "working_status",
  "condition",
  "project_name",
  "links",
  "notes",
  "verified_in_survey",
  "is_archived",
  "manual_entry",
  "picture_path",
  "created_at",
  "updated_at",
];

const SORT_COLUMNS = {
  assetNumber: "asset_number",
  description: "description",
  links: "links",
  location: "location",
  manufacturer: "manufacturer",
  model: "model",
  projectName: "project_name",
  qty: "qty",
  verified: "verified_in_survey",
};

const FILTER_COLUMNS = {
  assetNumber: "asset_number",
  description: "description",
  location: "location",
  manufacturer: "manufacturer",
  model: "model",
};

export function loadInventoryEntries(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);
  return {
    dbPath,
    entries: loadInventoryEntriesFromPath(dbPath),
    shared: getSharedInventoryStatus(dbPath),
  };
}

export function queryInventoryEntries(runtimeContext, input = {}) {
  const dbPath = resolveDbPath(runtimeContext);
  const result = queryInventoryEntriesFromPath(dbPath, input);

  return {
    ...result,
    dbPath,
    shared: getSharedInventoryStatus(dbPath),
  };
}

export function syncInventoryWithShared(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);
  const beforeFingerprint = getEntryDataFingerprint(dbPath);

  try {
    const sharedDbPath = ensureSharedDatabase(dbPath);
    const pushedOps = pushPendingLocalOps(dbPath, sharedDbPath);
    const pulledOps = pullSharedOps(dbPath, sharedDbPath);
    const afterFingerprint = getEntryDataFingerprint(dbPath);
    const entriesChanged = beforeFingerprint !== afterFingerprint;
    const revision = getAppliedOperationCount(sharedDbPath);

    if (pushedOps > 0 || pulledOps > 0) {
      setRevisionForPath(dbPath, revision, SHARED_SYNC_MARKER);
      setRevisionForPath(sharedDbPath, revision, SHARED_SYNC_MARKER);
    }

    return {
      dbPath,
      entries: entriesChanged ? loadInventoryEntriesFromPath(dbPath) : [],
      entriesChanged,
      shared: buildSharedStatus({
        available: true,
        canModify: true,
        hasLocalOnlyChanges: hasPendingOutbox(dbPath),
        message: buildSyncMessage(pushedOps, pulledOps),
        mutationMode: "shared",
        revision,
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
    hasLocalOnlyChanges: hasPendingOutbox(localDbPath),
    message: fs.existsSync(sharedDbPath)
      ? SHARED_CONNECTED_MESSAGE
      : fs.existsSync(legacySharedDbPath)
        ? "Shared workspace connected; legacy shared database will be migrated."
        : "Shared workspace connected; shared database will be initialized.",
    mutationMode: "shared",
    revision: getRevisionInfo(localDbPath).revision,
    sharedDbPath,
  });
}

export function createInventoryEntry(runtimeContext, entryInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const entry = normalizeEntryInput(entryInput);

  validateEntryInput(entry);

  const result = runLocalMutation(dbPath, (db, context) => {
    const entryUuid = randomUUID();
    const timestamp = context.mutationTs;

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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
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
      timestamp,
      timestamp,
    );

    const row = selectEntryRowByUuid(db, entryUuid);
    enqueueAndRecordLocalOperation(db, {
      clientId: context.clientId,
      entryUuid,
      mutationTs: timestamp,
      opId: context.opId,
      opType: "upsert",
      payload: buildUpsertPayload(row),
    });
    updateEntrySyncState(db, entryUuid, timestamp, context.opId, context.clientId, hashEntryRow(row));
    return mapEntryRow(row);
  });

  return buildEntryMutationResult({
    dbPath,
    entry: result,
    message: "Entry added locally. Sync pending.",
  });
}

export function toggleVerifiedEntry(runtimeContext, entryId, nextVerified) {
  const dbPath = resolveDbPath(runtimeContext);

  const result = runLocalMutation(dbPath, (db, context) => {
    const selector = resolveEntrySelectorForDb(db, entryId);
    db.prepare(
      `
        UPDATE entries
        SET verified_in_survey = ?, updated_at = ?
        WHERE ${selector.whereSql}
      `,
    ).run(nextVerified ? 1 : 0, context.mutationTs, selector.value);

    const row = selectEntryRowBySelector(db, selector);
    enqueueAndRecordLocalOperation(db, {
      clientId: context.clientId,
      entryUuid: row.entry_uuid,
      mutationTs: context.mutationTs,
      opId: context.opId,
      opType: "upsert",
      payload: buildUpsertPayload(row),
    });
    updateEntrySyncState(db, row.entry_uuid, context.mutationTs, context.opId, context.clientId, hashEntryRow(row));
    return mapEntryRow(row);
  });

  return buildEntryMutationResult({
    dbPath,
    entry: result,
    message: "Verified state updated locally. Sync pending.",
  });
}

export function updateInventoryEntry(runtimeContext, entryId, entryInput) {
  const dbPath = resolveDbPath(runtimeContext);
  const entry = normalizeEntryInput(entryInput);

  validateEntryInput(entry);

  const result = runLocalMutation(dbPath, (db, context) => {
    const selector = resolveEntrySelectorForDb(db, entryId);
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
          updated_at = ?
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
      context.mutationTs,
      selector.value,
    );

    const row = selectEntryRowBySelector(db, selector);
    enqueueAndRecordLocalOperation(db, {
      clientId: context.clientId,
      entryUuid: row.entry_uuid,
      mutationTs: context.mutationTs,
      opId: context.opId,
      opType: "upsert",
      payload: buildUpsertPayload(row),
    });
    updateEntrySyncState(db, row.entry_uuid, context.mutationTs, context.opId, context.clientId, hashEntryRow(row));
    return mapEntryRow(row);
  });

  return buildEntryMutationResult({
    dbPath,
    entry: result,
    message: "Entry updated locally. Sync pending.",
  });
}

export function setArchivedEntry(runtimeContext, entryId, archived) {
  const dbPath = resolveDbPath(runtimeContext);

  const result = runLocalMutation(dbPath, (db, context) => {
    const selector = resolveEntrySelectorForDb(db, entryId);
    db.prepare(
      `
        UPDATE entries
        SET is_archived = ?, updated_at = ?
        WHERE ${selector.whereSql}
      `,
    ).run(archived ? 1 : 0, context.mutationTs, selector.value);

    const row = selectEntryRowBySelector(db, selector);
    enqueueAndRecordLocalOperation(db, {
      clientId: context.clientId,
      entryUuid: row.entry_uuid,
      mutationTs: context.mutationTs,
      opId: context.opId,
      opType: "upsert",
      payload: buildUpsertPayload(row),
    });
    updateEntrySyncState(db, row.entry_uuid, context.mutationTs, context.opId, context.clientId, hashEntryRow(row));
    return mapEntryRow(row);
  });

  return buildEntryMutationResult({
    dbPath,
    entry: result,
    message: archived ? "Entry moved to the archive locally. Sync pending." : "Entry restored locally. Sync pending.",
  });
}

export function deleteInventoryEntry(runtimeContext, entryId) {
  const dbPath = resolveDbPath(runtimeContext);

  const deletedEntryId = runLocalMutation(dbPath, (db, context) => {
    const selector = resolveEntrySelectorForDb(db, entryId);
    const row = selectEntryRowBySelector(db, selector);
    const entryUuid = String(row.entry_uuid);

    db.prepare(`DELETE FROM entries WHERE ${selector.whereSql}`).run(selector.value);
    db.prepare(
      `
        INSERT INTO entry_tombstones (entry_uuid, deleted_at, deleted_by_client_id, op_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_uuid) DO UPDATE SET
          deleted_at = excluded.deleted_at,
          deleted_by_client_id = excluded.deleted_by_client_id,
          op_id = excluded.op_id
      `,
    ).run(entryUuid, context.mutationTs, context.clientId, context.opId);

    enqueueAndRecordLocalOperation(db, {
      clientId: context.clientId,
      entryUuid,
      mutationTs: context.mutationTs,
      opId: context.opId,
      opType: "delete",
      payload: {
        deletedAt: context.mutationTs,
        entryUuid,
      },
    });
    updateEntrySyncState(db, entryUuid, context.mutationTs, context.opId, context.clientId, "deleted");
    return entryUuid;
  });

  return buildDeleteMutationResult({
    dbPath,
    entryId: deletedEntryId,
    message: "Entry deleted locally. Sync pending.",
  });
}

function queryInventoryEntriesFromPath(dbPath, input = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const query = normalizeInventoryQueryInput(input);

  try {
    const { whereSql, params } = buildWhereClause(query);
    const orderSql = buildOrderSql(query.sort);
    const entries = db
      .prepare(
        `
          SELECT ${SELECT_FIELDS}
          FROM entries
          ${whereSql}
          ${orderSql}
          LIMIT ? OFFSET ?
        `,
      )
      .all(...params, query.limit, query.offset)
      .map(mapEntryRow);
    const totalFiltered = Number(
      db.prepare(`SELECT COUNT(*) AS count FROM entries ${whereSql}`).get(...params)?.count ?? 0,
    );

    return {
      counts: getInventoryCountsFromDb(db),
      entries,
      totalFiltered,
    };
  } finally {
    db.close();
  }
}

function loadInventoryEntriesFromPath(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    return db
      .prepare(`SELECT ${SELECT_FIELDS} FROM entries ORDER BY updated_at DESC, entry_id DESC`)
      .all()
      .map(mapEntryRow);
  } finally {
    db.close();
  }
}

function normalizeInventoryQueryInput(input) {
  const limit = Math.max(0, Math.min(MAX_QUERY_LIMIT, Number(input?.limit ?? MAX_QUERY_LIMIT) || MAX_QUERY_LIMIT));
  const offset = Math.max(0, Number(input?.offset ?? 0) || 0);
  const sort = input?.sort ?? { column: "manufacturer", direction: "asc" };

  return {
    filters: {
      assetNumber: normalizeText(input?.filters?.assetNumber),
      description: normalizeText(input?.filters?.description),
      location: normalizeText(input?.filters?.location),
      manufacturer: normalizeText(input?.filters?.manufacturer),
      model: normalizeText(input?.filters?.model),
    },
    limit,
    offset,
    query: normalizeText(input?.query),
    scope: input?.scope === "archive" ? "archive" : "inventory",
    sort: {
      column: SORT_COLUMNS[sort.column] ? sort.column : "manufacturer",
      direction: sort.direction === "desc" ? "desc" : "asc",
    },
  };
}

function buildWhereClause(query) {
  const where = [];
  const params = [];

  where.push(query.scope === "archive" ? "entries.is_archived = 1" : "entries.is_archived = 0");

  for (const [field, value] of Object.entries(query.filters)) {
    if (!value) {
      continue;
    }
    where.push(`entries.${FILTER_COLUMNS[field]} LIKE ? ESCAPE '\\'`);
    params.push(buildLikePattern(value));
  }

  if (query.query) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM entry_search
        WHERE entry_search.entry_id = entries.entry_id
          AND entry_search.search_text LIKE ? ESCAPE '\\'
      )
    `);
    params.push(buildLikePattern(query.query));
  }

  return {
    params,
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
  };
}

function buildLikePattern(value) {
  return `%${String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function buildOrderSql(sort) {
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  const column = SORT_COLUMNS[sort.column] ?? "manufacturer";

  if (sort.column === "qty") {
    return `ORDER BY CASE WHEN entries.${column} IS NULL THEN 1 ELSE 0 END ASC, entries.${column} ${direction}, entries.updated_at DESC, entries.entry_id DESC`;
  }

  if (sort.column === "verified") {
    return `ORDER BY entries.${column} ${direction}, entries.updated_at DESC, entries.entry_id DESC`;
  }

  return `ORDER BY CASE WHEN trim(coalesce(entries.${column}, '')) = '' THEN 1 ELSE 0 END ASC, lower(trim(coalesce(entries.${column}, ''))) ${direction}, entries.updated_at DESC, entries.entry_id DESC`;
}

function getInventoryCountsFromDb(db) {
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_archived = 0 THEN 1 ELSE 0 END) AS inventory,
          SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) AS archive,
          SUM(CASE WHEN verified_in_survey = 1 THEN 1 ELSE 0 END) AS verified
        FROM entries
      `,
    )
    .get();

  return {
    archive: Number(row?.archive ?? 0),
    inventory: Number(row?.inventory ?? 0),
    total: Number(row?.total ?? 0),
    verified: Number(row?.verified ?? 0),
  };
}

function runLocalMutation(localDbPath, mutate) {
  ensureInventorySchema(localDbPath);
  const db = new DatabaseSync(localDbPath);

  try {
    db.exec("PRAGMA journal_mode=DELETE");
    db.exec("PRAGMA synchronous=FULL");
    db.exec("BEGIN IMMEDIATE");
    const context = {
      clientId: ensureClientIdentityForDb(db),
      mutationTs: new Date().toISOString(),
      opId: randomUUID(),
    };
    const result = mutate(db, context);
    incrementLocalRevision(db);
    db.exec("COMMIT");
    return result;
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

function enqueueAndRecordLocalOperation(db, operation) {
  const payloadJson = JSON.stringify(operation.payload);
  db.prepare(
    `
      INSERT INTO sync_outbox (
        op_id,
        client_id,
        op_type,
        entry_uuid,
        mutation_ts,
        payload_json,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `,
  ).run(
    operation.opId,
    operation.clientId,
    operation.opType,
    operation.entryUuid,
    operation.mutationTs,
    payloadJson,
    operation.mutationTs,
  );

  recordAppliedOperation(db, {
    ...operation,
    payloadJson,
    result: "applied_local",
  });
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

  if (!fs.existsSync(sharedDbPath)) {
    bootstrapSharedDatabase(localDbPath, sharedDbPath);
    return sharedDbPath;
  }

  ensureInventorySchema(sharedDbPath);
  if (getEntryCount(sharedDbPath) === 0 && getAppliedOperationCount(sharedDbPath) === 0 && getEntryCount(localDbPath) > 0) {
    bootstrapSharedDatabase(localDbPath, sharedDbPath);
  }

  return sharedDbPath;
}

function bootstrapSharedDatabase(localDbPath, sharedDbPath) {
  replaceDatabaseFile(localDbPath, sharedDbPath);
  ensureInventorySchema(sharedDbPath);
  clearOutboxForBootstrap(sharedDbPath);
  markAllPendingOutboxSynced(localDbPath);
}

function clearOutboxForBootstrap(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("UPDATE sync_outbox SET status = 'synced', last_error = '', last_attempt_at = datetime('now')").run();
  } finally {
    db.close();
  }
}

function pushPendingLocalOps(localDbPath, sharedDbPath) {
  const pendingOps = loadPendingOutbox(localDbPath);
  if (pendingOps.length === 0) {
    return 0;
  }

  const sharedDb = new DatabaseSync(sharedDbPath);
  const appliedOpIds = [];

  try {
    sharedDb.exec("PRAGMA journal_mode=DELETE");
    sharedDb.exec("PRAGMA synchronous=FULL");
    sharedDb.exec("PRAGMA busy_timeout = 2000");
    sharedDb.exec("BEGIN IMMEDIATE");
    for (const operation of pendingOps) {
      applyOperationToDb(sharedDb, operation);
      appliedOpIds.push(operation.opId);
    }
    setRevision(sharedDb, getAppliedOperationCountForDb(sharedDb), SHARED_SYNC_MARKER);
    sharedDb.exec("COMMIT");
  } catch (error) {
    try {
      sharedDb.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors when SQLite already closed the transaction.
    }

    if (error instanceof Error && /busy|locked/i.test(error.message)) {
      throw new Error(SHARED_BUSY_MESSAGE);
    }
    throw error;
  } finally {
    sharedDb.close();
  }

  markOutboxOpsSynced(localDbPath, appliedOpIds);
  return appliedOpIds.length;
}

function pullSharedOps(localDbPath, sharedDbPath) {
  const sharedOps = loadAppliedOperations(sharedDbPath);
  if (sharedOps.length === 0) {
    return 0;
  }

  const localApplied = loadAppliedOperationIds(localDbPath);
  const missingOps = sharedOps.filter((operation) => !localApplied.has(operation.opId));
  if (missingOps.length === 0) {
    return 0;
  }

  const localDb = new DatabaseSync(localDbPath);
  try {
    localDb.exec("BEGIN IMMEDIATE");
    for (const operation of missingOps) {
      applyOperationToDb(localDb, operation);
    }
    setRevision(localDb, getAppliedOperationCountForDb(localDb), SHARED_SYNC_MARKER);
    localDb.exec("COMMIT");
  } catch (error) {
    try {
      localDb.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors when SQLite already closed the transaction.
    }
    throw error;
  } finally {
    localDb.close();
  }

  return missingOps.length;
}

function loadPendingOutbox(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `
          SELECT
            op_id AS opId,
            client_id AS clientId,
            op_type AS opType,
            entry_uuid AS entryUuid,
            mutation_ts AS mutationTs,
            payload_json AS payloadJson
          FROM sync_outbox
          WHERE status <> 'synced'
          ORDER BY mutation_ts ASC, created_at ASC, op_id ASC
        `,
      )
      .all();
  } finally {
    db.close();
  }
}

function loadAppliedOperations(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `
          SELECT
            op_id AS opId,
            client_id AS clientId,
            op_type AS opType,
            entry_uuid AS entryUuid,
            mutation_ts AS mutationTs,
            payload_json AS payloadJson
          FROM applied_ops
          ORDER BY mutation_ts ASC, op_id ASC
        `,
      )
      .all();
  } finally {
    db.close();
  }
}

function loadAppliedOperationIds(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return new Set(db.prepare("SELECT op_id FROM applied_ops").all().map((row) => String(row.op_id ?? "")));
  } finally {
    db.close();
  }
}

function applyOperationToDb(db, operation) {
  const opId = String(operation.opId ?? "");
  if (!opId || appliedOperationExists(db, opId)) {
    return;
  }

  if (operation.opType === "delete") {
    applyDeleteOperation(db, operation);
  } else {
    applyUpsertOperation(db, operation);
  }
}

function applyUpsertOperation(db, operation) {
  const payload = parseOperationPayload(operation.payloadJson);
  const entry = payload.entry;
  const entryUuid = String(entry?.entryUuid ?? operation.entryUuid ?? "").trim();
  if (!entryUuid) {
    throw new Error("Sync upsert operation is missing an entry UUID.");
  }

  const currentClock = getCurrentMutationClock(db, entryUuid);
  const incomingClock = {
    opId: String(operation.opId ?? ""),
    ts: String(operation.mutationTs || entry.updatedAt || ""),
  };

  if (currentClock && compareMutationClocks(currentClock, incomingClock) > 0) {
    recordSyncConflict(db, entryUuid, "Skipped older upsert operation.");
    recordAppliedOperation(db, { ...operation, result: "skipped_older" });
    return;
  }

  db.prepare("DELETE FROM entry_tombstones WHERE entry_uuid = ?").run(entryUuid);
  const entryValues = {
    archived: entry.archived ? 1 : 0,
    assetNumber: normalizeText(entry.assetNumber),
    assignedTo: normalizeText(entry.assignedTo),
    condition: normalizeText(entry.condition),
    createdAt: normalizeText(entry.createdAt) || incomingClock.ts,
    description: normalizeText(entry.description),
    lifecycleStatus: normalizeEnum(entry.lifecycleStatus, ["active", "repair", "scrapped", "missing", "rental"], "active"),
    links: normalizeText(entry.links),
    location: normalizeText(entry.location),
    manufacturer: normalizeText(entry.manufacturer),
    manualEntry: entry.manualEntry ? 1 : 0,
    model: normalizeText(entry.model),
    notes: normalizeText(entry.notes),
    picturePath: normalizeText(entry.picturePath),
    projectName: normalizeText(entry.projectName),
    qty: normalizeQty(entry.qty),
    serialNumber: normalizeText(entry.serialNumber),
    updatedAt: incomingClock.ts,
    verifiedInSurvey: entry.verifiedInSurvey ? 1 : 0,
    workingStatus: normalizeEnum(entry.workingStatus, ["unknown", "working", "limited", "not_working"], "unknown"),
  };

  const updateResult = db.prepare(
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
        manual_entry = ?,
        picture_path = ?,
        updated_at = ?
      WHERE entry_uuid = ?
    `,
  ).run(
    entryValues.assetNumber,
    entryValues.serialNumber,
    entryValues.manufacturer,
    entryValues.manufacturer,
    entryValues.model,
    entryValues.description,
    entryValues.qty,
    entryValues.location,
    entryValues.assignedTo,
    entryValues.lifecycleStatus,
    entryValues.workingStatus,
    entryValues.condition,
    entryValues.projectName,
    entryValues.links,
    entryValues.notes,
    entryValues.verifiedInSurvey,
    entryValues.archived,
    entryValues.manualEntry,
    entryValues.picturePath,
    entryValues.updatedAt,
    entryUuid,
  );

  if (Number(updateResult.changes ?? 0) === 0) {
    db.prepare(
      `
        INSERT INTO entries (${ENTRY_COLUMNS.join(", ")})
        VALUES (${ENTRY_COLUMNS.map(() => "?").join(", ")})
      `,
    ).run(
      entryUuid,
      entryValues.assetNumber,
      entryValues.serialNumber,
      entryValues.manufacturer,
      entryValues.manufacturer,
      entryValues.model,
      entryValues.description,
      entryValues.qty,
      entryValues.location,
      entryValues.assignedTo,
      entryValues.lifecycleStatus,
      entryValues.workingStatus,
      entryValues.condition,
      entryValues.projectName,
      entryValues.links,
      entryValues.notes,
      entryValues.verifiedInSurvey,
      entryValues.archived,
      entryValues.manualEntry,
      entryValues.picturePath,
      entryValues.createdAt,
      entryValues.updatedAt,
    );
  }

  updateEntrySyncState(db, entryUuid, incomingClock.ts, incomingClock.opId, operation.clientId, hashStableObject(entry));
  recordAppliedOperation(db, { ...operation, result: "applied_upsert" });
}

function applyDeleteOperation(db, operation) {
  const payload = parseOperationPayload(operation.payloadJson);
  const entryUuid = String(payload.entryUuid ?? operation.entryUuid ?? "").trim();
  if (!entryUuid) {
    throw new Error("Sync delete operation is missing an entry UUID.");
  }

  const incomingClock = {
    opId: String(operation.opId ?? ""),
    ts: String(operation.mutationTs || payload.deletedAt || ""),
  };
  const currentClock = getCurrentMutationClock(db, entryUuid);

  if (currentClock && compareMutationClocks(currentClock, incomingClock) > 0) {
    recordSyncConflict(db, entryUuid, "Skipped older delete operation.");
    recordAppliedOperation(db, { ...operation, result: "skipped_older" });
    return;
  }

  db.prepare("DELETE FROM entries WHERE entry_uuid = ?").run(entryUuid);
  db.prepare(
    `
      INSERT INTO entry_tombstones (entry_uuid, deleted_at, deleted_by_client_id, op_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entry_uuid) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        deleted_by_client_id = excluded.deleted_by_client_id,
        op_id = excluded.op_id
    `,
  ).run(entryUuid, incomingClock.ts, operation.clientId, incomingClock.opId);

  updateEntrySyncState(db, entryUuid, incomingClock.ts, incomingClock.opId, operation.clientId, "deleted");
  recordAppliedOperation(db, { ...operation, result: "applied_delete" });
}

function parseOperationPayload(payloadJson) {
  try {
    return JSON.parse(String(payloadJson ?? "{}"));
  } catch {
    return {};
  }
}

function appliedOperationExists(db, opId) {
  const row = db.prepare("SELECT op_id FROM applied_ops WHERE op_id = ? LIMIT 1").get(opId);
  return Boolean(row);
}

function recordAppliedOperation(db, operation) {
  db.prepare(
    `
      INSERT INTO applied_ops (
        op_id,
        client_id,
        op_type,
        entry_uuid,
        mutation_ts,
        payload_json,
        applied_at,
        result
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(op_id) DO NOTHING
    `,
  ).run(
    operation.opId,
    operation.clientId,
    operation.opType,
    operation.entryUuid,
    operation.mutationTs,
    operation.payloadJson ?? JSON.stringify(operation.payload ?? {}),
    operation.result ?? "applied",
  );
}

function getCurrentMutationClock(db, entryUuid) {
  const stateRow = db
    .prepare("SELECT last_mutation_ts, last_op_id FROM entry_sync_state WHERE entry_uuid = ? LIMIT 1")
    .get(entryUuid);
  const tombstoneRow = db
    .prepare("SELECT deleted_at, op_id FROM entry_tombstones WHERE entry_uuid = ? LIMIT 1")
    .get(entryUuid);
  const entryRow = db.prepare("SELECT updated_at FROM entries WHERE entry_uuid = ? LIMIT 1").get(entryUuid);

  const candidates = [
    stateRow
      ? { opId: String(stateRow.last_op_id ?? ""), ts: String(stateRow.last_mutation_ts ?? "") }
      : null,
    tombstoneRow
      ? { opId: String(tombstoneRow.op_id ?? ""), ts: String(tombstoneRow.deleted_at ?? "") }
      : null,
    entryRow ? { opId: "", ts: String(entryRow.updated_at ?? "") } : null,
  ].filter((candidate) => candidate && candidate.ts);

  return candidates.sort(compareMutationClocks).at(-1) ?? null;
}

function compareMutationClocks(left, right) {
  const leftTs = String(left?.ts ?? "");
  const rightTs = String(right?.ts ?? "");
  if (leftTs < rightTs) {
    return -1;
  }
  if (leftTs > rightTs) {
    return 1;
  }

  const leftOpId = String(left?.opId ?? "");
  const rightOpId = String(right?.opId ?? "");
  if (leftOpId < rightOpId) {
    return -1;
  }
  if (leftOpId > rightOpId) {
    return 1;
  }
  return 0;
}

function recordSyncConflict(db, entryUuid, summary) {
  db.prepare(
    `
      INSERT INTO sync_conflicts (entry_uuid, summary, created_at, resolved)
      VALUES (?, ?, datetime('now'), 0)
    `,
  ).run(entryUuid, summary);
}

function markOutboxOpsSynced(localDbPath, opIds) {
  if (opIds.length === 0) {
    return;
  }

  const db = new DatabaseSync(localDbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const statement = db.prepare(
      "UPDATE sync_outbox SET status = 'synced', last_error = '', last_attempt_at = datetime('now') WHERE op_id = ?",
    );
    for (const opId of opIds) {
      statement.run(opId);
    }
    db.exec("COMMIT");
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

function markAllPendingOutboxSynced(localDbPath) {
  const db = new DatabaseSync(localDbPath);
  try {
    db.prepare("UPDATE sync_outbox SET status = 'synced', last_error = '', last_attempt_at = datetime('now')").run();
  } finally {
    db.close();
  }
}

function hasPendingOutbox(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return false;
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status <> 'synced'").get();
    return Number(row?.count ?? 0) > 0;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

function buildEntryMutationResult({ dbPath, entry, message }) {
  return {
    entry,
    message,
    mutationMode: "local",
    shared: buildLocalSharedStatus(LOCAL_MUTATION_MESSAGE, dbPath),
  };
}

function buildDeleteMutationResult({ dbPath, entryId, message }) {
  return {
    entryId: String(entryId),
    message,
    mutationMode: "local",
    shared: buildLocalSharedStatus(LOCAL_MUTATION_MESSAGE, dbPath),
  };
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

function getAppliedOperationCount(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return 0;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return getAppliedOperationCountForDb(db);
  } finally {
    db.close();
  }
}

function getAppliedOperationCountForDb(db) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM applied_ops").get();
  return Number(row?.count ?? 0);
}

function setRevisionForPath(dbPath, revision, updatedBy) {
  const db = new DatabaseSync(dbPath);

  try {
    setRevision(db, revision, updatedBy);
  } finally {
    db.close();
  }
}

function incrementLocalRevision(db) {
  const currentRevision = getRevisionForDb(db);
  setRevision(db, currentRevision + 1, LOCAL_MUTATION_MARKER);
}

function getRevisionForDb(db) {
  const row = db.prepare("SELECT revision FROM sync_state WHERE id = 1 LIMIT 1").get();
  return parseRevision(row?.revision);
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

function ensureClientIdentityForDb(db) {
  const existing = db.prepare("SELECT client_id FROM client_identity WHERE id = 1 LIMIT 1").get();
  const existingClientId = String(existing?.client_id ?? "").trim();
  if (existingClientId) {
    return existingClientId;
  }

  const clientId = randomUUID();
  db.prepare(
    `
      INSERT INTO client_identity (id, client_id, created_at)
      VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id
    `,
  ).run(clientId);
  return clientId;
}

function resolveEntrySelectorForDb(db, entryId) {
  const text = String(entryId ?? "").trim();
  if (!text) {
    throw new Error("Invalid database entry id.");
  }

  const uuidRow = db.prepare("SELECT entry_uuid FROM entries WHERE entry_uuid = ? LIMIT 1").get(text);
  if (uuidRow) {
    return {
      value: text,
      whereSql: "entry_uuid = ?",
      type: "uuid",
    };
  }

  const numericEntryId = Number(text);
  if (Number.isInteger(numericEntryId)) {
    const row = db.prepare("SELECT entry_uuid FROM entries WHERE entry_id = ? LIMIT 1").get(numericEntryId);
    const entryUuid = String(row?.entry_uuid ?? "").trim();
    if (entryUuid) {
      return {
        value: entryUuid,
        whereSql: "entry_uuid = ?",
        type: "uuid",
      };
    }
    return {
      value: numericEntryId,
      whereSql: "entry_id = ?",
      type: "id",
    };
  }

  throw new Error("The selected entry could not be found.");
}

function selectEntryRowByUuid(db, entryUuid) {
  const row = db.prepare(`SELECT ${SELECT_FIELDS} FROM entries WHERE entry_uuid = ? LIMIT 1`).get(entryUuid);
  if (!row) {
    throw new Error("Entry not found after database update.");
  }
  return row;
}

function selectEntryRowBySelector(db, selector) {
  const row = db.prepare(`SELECT ${SELECT_FIELDS} FROM entries WHERE ${selector.whereSql} LIMIT 1`).get(selector.value);
  if (!row) {
    throw new Error("Entry not found after database update.");
  }
  return row;
}

function buildUnavailableSharedStatus(error, localDbPath = "") {
  const message = error instanceof Error && error.message ? error.message : SHARED_UNAVAILABLE_MESSAGE;
  return buildLocalSharedStatus(
    message === "Shared workspace path is not configured."
      ? "Shared workspace path is not configured. Saving changes locally."
      : message,
    localDbPath,
  );
}

function buildLocalSharedStatus(message, localDbPath) {
  const revisionInfo = getRevisionInfo(localDbPath);

  return buildSharedStatus({
    available: false,
    canModify: true,
    hasLocalOnlyChanges: hasPendingOutbox(localDbPath) || revisionInfo.updatedBy === LOCAL_MUTATION_MARKER,
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
  } catch {
    return { revision: 0, updatedBy: "" };
  } finally {
    db.close();
  }
}

function buildSyncMessage(pushedOps, pulledOps) {
  if (pushedOps > 0 && pulledOps > 0) {
    return `Shared workspace connected. Synced ${pushedOps} local and ${pulledOps} shared changes.`;
  }
  if (pushedOps > 0) {
    return `Shared workspace connected. Synced ${pushedOps} local changes.`;
  }
  if (pulledOps > 0) {
    return `Shared workspace connected. Pulled ${pulledOps} shared changes.`;
  }
  return SHARED_CONNECTED_MESSAGE;
}

function mapEntryRow(row) {
  const entryUuid = String(row.entry_uuid ?? "");
  return {
    id: entryUuid || String(row.entry_id ?? ""),
    databaseId: Number(row.entry_id ?? 0) || undefined,
    entryUuid,
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

function buildUpsertPayload(row) {
  return {
    entry: {
      archived: Boolean(row.is_archived),
      assetNumber: String(row.asset_number ?? ""),
      assignedTo: String(row.assigned_to ?? ""),
      condition: String(row.condition ?? ""),
      createdAt: String(row.created_at ?? ""),
      description: String(row.description ?? ""),
      entryUuid: String(row.entry_uuid ?? ""),
      lifecycleStatus: String(row.lifecycle_status ?? "active"),
      links: String(row.links ?? ""),
      location: String(row.location ?? ""),
      manufacturer: String(row.manufacturer ?? ""),
      manualEntry: Boolean(row.manual_entry),
      model: String(row.model ?? ""),
      notes: String(row.notes ?? ""),
      picturePath: String(row.picture_path ?? ""),
      projectName: String(row.project_name ?? ""),
      qty: row.qty == null ? null : Number(row.qty),
      serialNumber: String(row.serial_number ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      verifiedInSurvey: Boolean(row.verified_in_survey),
      workingStatus: String(row.working_status ?? "unknown"),
    },
  };
}

function updateEntrySyncState(db, entryUuid, mutationTs, opId, clientId, hash) {
  db.prepare(
    `
      INSERT INTO entry_sync_state (
        entry_uuid,
        last_synced_hash,
        synced_at,
        last_mutation_ts,
        last_op_id,
        last_client_id
      ) VALUES (?, ?, datetime('now'), ?, ?, ?)
      ON CONFLICT(entry_uuid) DO UPDATE SET
        last_synced_hash = excluded.last_synced_hash,
        synced_at = datetime('now'),
        last_mutation_ts = excluded.last_mutation_ts,
        last_op_id = excluded.last_op_id,
        last_client_id = excluded.last_client_id
    `,
  ).run(entryUuid, hash, mutationTs, opId, clientId);
}

function hashEntryRow(row) {
  return hashStableObject(buildUpsertPayload(row).entry);
}

function hashStableObject(value) {
  return createHash("sha256").update(JSON.stringify(sortObjectKeys(value))).digest("hex");
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObjectKeys(value[key]);
      return result;
    }, {});
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
