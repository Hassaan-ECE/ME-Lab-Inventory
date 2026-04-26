import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DB_FILENAME = "me_inventory.db";
export const LEGACY_DB_FILENAME = "me_lab_inventory.db";
export const SHARED_DB_FILENAME = "me_inventory_shared.db";
export const LEGACY_SHARED_DB_FILENAME = "me_lab_shared.db";
export const SHARED_ROOT_ENV_VAR = "ME_LAB_SHARED_ROOT";
export const DEFAULT_SHARED_ROOT = "S:\\Manufacturing\\Internal\\_Syed_H_Shah\\InventoryApps\\ME";
export const SHARED_SYNC_INTERVAL_MS = 10_000;
export const INVENTORY_SCHEMA_VERSION = 2;

export function resolveDbPath({ appPath, isPackaged, resourcesPath, userDataPath }) {
  if (!isPackaged) {
    const developmentDataDirs = [
      path.join(appPath, "data"),
      path.join(path.dirname(appPath), "data"),
      path.join(process.cwd(), "data"),
    ];

    return resolveCurrentDatabaseFromDirectories(
      developmentDataDirs,
      "No development database was found in the project data directory.",
    );
  }

  const bundledSeedPath = path.join(resourcesPath, "data", DB_FILENAME);
  const legacyBundledSeedPath = path.join(resourcesPath, "data", LEGACY_DB_FILENAME);
  const runtimeDataDir = path.join(userDataPath, "data");
  const runtimeDbPath = path.join(runtimeDataDir, DB_FILENAME);
  const legacyRuntimeDbPath = path.join(runtimeDataDir, LEGACY_DB_FILENAME);

  fs.mkdirSync(runtimeDataDir, { recursive: true });
  if (!fs.existsSync(runtimeDbPath)) {
    if (fs.existsSync(legacyRuntimeDbPath)) {
      fs.copyFileSync(legacyRuntimeDbPath, runtimeDbPath);
    } else if (fs.existsSync(bundledSeedPath)) {
      fs.copyFileSync(bundledSeedPath, runtimeDbPath);
    } else if (fs.existsSync(legacyBundledSeedPath)) {
      fs.copyFileSync(legacyBundledSeedPath, runtimeDbPath);
    } else {
      throw new Error("Bundled database seed is missing.");
    }
  }

  ensureInventorySchema(runtimeDbPath);
  return runtimeDbPath;
}

export function resolveSharedRootPath() {
  const configuredRoot = process.env[SHARED_ROOT_ENV_VAR]?.trim() || DEFAULT_SHARED_ROOT;
  return configuredRoot ? path.resolve(configuredRoot) : "";
}

export function resolveSharedDirectoryPath() {
  const sharedRootPath = resolveSharedRootPath();
  return sharedRootPath ? path.join(sharedRootPath, "shared") : "";
}

export function resolveSharedDbPath() {
  const sharedDirectoryPath = resolveSharedDirectoryPath();
  return sharedDirectoryPath ? path.join(sharedDirectoryPath, SHARED_DB_FILENAME) : "";
}

export function resolveLegacySharedDbPath() {
  const sharedDirectoryPath = resolveSharedDirectoryPath();
  return sharedDirectoryPath ? path.join(sharedDirectoryPath, LEGACY_SHARED_DB_FILENAME) : "";
}

export function ensureInventorySchema(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return;
  }

  const db = new DatabaseSync(dbPath);

  try {
    if (hasCurrentInventorySchema(db)) {
      return;
    }

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    migrateInventorySchema(db);
    db.exec(`PRAGMA user_version = ${INVENTORY_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors when SQLite has already closed the transaction.
    }
    throw error;
  } finally {
    db.close();
  }
}

function hasCurrentInventorySchema(db) {
  const versionRow = db.prepare("PRAGMA user_version").get();
  const version = Number(versionRow?.user_version ?? 0);

  return (
    version >= INVENTORY_SCHEMA_VERSION &&
    tableExists(db, "entries") &&
    columnExists(db, "entries", "entry_uuid") &&
    tableExists(db, "entry_search") &&
    tableExists(db, "sync_outbox") &&
    tableExists(db, "applied_ops") &&
    tableExists(db, "entry_tombstones") &&
    columnExists(db, "applied_ops", "payload_json") &&
    columnExists(db, "entry_sync_state", "last_mutation_ts") &&
    triggerExists(db, "entries_ai_entry_search") &&
    triggerExists(db, "entries_au_entry_search") &&
    triggerExists(db, "entries_ad_entry_search") &&
    !tableExists(db, "equipment")
  );
}

function resolveCurrentDatabaseFromDirectories(dataDirs, missingMessage) {
  for (const dataDir of dataDirs) {
    const candidatePath = path.join(dataDir, DB_FILENAME);
    if (fs.existsSync(candidatePath)) {
      ensureInventorySchema(candidatePath);
      return candidatePath;
    }

    const legacyPath = path.join(dataDir, LEGACY_DB_FILENAME);
    if (fs.existsSync(legacyPath)) {
      const targetPath = path.join(dataDir, DB_FILENAME);
      fs.mkdirSync(dataDir, { recursive: true });
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(legacyPath, targetPath);
      }
      ensureInventorySchema(targetPath);
      return targetPath;
    }
  }

  throw new Error(missingMessage);
}

function migrateInventorySchema(db) {
  renameTableIfNeeded(db, "equipment", "entries");
  renameColumnIfNeeded(db, "entries", "record_id", "entry_id");
  renameColumnIfNeeded(db, "entries", "record_uuid", "entry_uuid");
  if (tableExists(db, "sqlite_sequence")) {
    db.prepare("UPDATE sqlite_sequence SET name = ? WHERE name = ?").run("entries", "equipment");
  }

  renameTableIfNeeded(db, "equipment_tombstones", "entry_tombstones");
  renameColumnIfNeeded(db, "entry_tombstones", "record_uuid", "entry_uuid");

  renameTableIfNeeded(db, "record_sync_state", "entry_sync_state");
  renameColumnIfNeeded(db, "entry_sync_state", "record_uuid", "entry_uuid");

  renameColumnIfNeeded(db, "applied_ops", "record_uuid", "entry_uuid");
  renameColumnIfNeeded(db, "sync_outbox", "record_uuid", "entry_uuid");
  renameColumnIfNeeded(db, "sync_conflicts", "record_uuid", "entry_uuid");
  renameColumnIfNeeded(db, "sync_state", "equipment_snapshot_hash", "entry_snapshot_hash");

  createCoreTablesIfMissing(db);
  addMissingColumns(db);
  normalizeEntryUuids(db);
  rebuildEntrySearchIndex(db);
  rebuildEntryIndexes(db);
  rebuildEntrySearchTriggers(db);
  seedEntrySyncState(db);
}

function createCoreTablesIfMissing(db) {
  if (!tableExists(db, "entries")) {
    db.exec(`
      CREATE TABLE entries (
        entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_uuid TEXT DEFAULT '',
        asset_number TEXT DEFAULT '',
        serial_number TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '',
        manufacturer_raw TEXT DEFAULT '',
        model TEXT DEFAULT '',
        description TEXT DEFAULT '',
        qty REAL,
        location TEXT DEFAULT '',
        assigned_to TEXT DEFAULT '',
        ownership_type TEXT DEFAULT 'owned',
        rental_vendor TEXT DEFAULT '',
        rental_cost_monthly REAL,
        calibration_status TEXT DEFAULT 'unknown',
        last_calibration_date TEXT DEFAULT '',
        calibration_due_date TEXT DEFAULT '',
        calibration_vendor TEXT DEFAULT '',
        calibration_cost REAL,
        lifecycle_status TEXT DEFAULT 'active',
        working_status TEXT DEFAULT 'unknown',
        condition TEXT DEFAULT '',
        acquired_date TEXT DEFAULT '',
        estimated_age_years REAL,
        age_basis TEXT DEFAULT 'unknown',
        verified_in_survey INTEGER DEFAULT 0,
        blue_dot_ref TEXT DEFAULT '',
        project_name TEXT DEFAULT '',
        picture_path TEXT DEFAULT '',
        links TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        manual_entry INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        source_refs TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS client_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      client_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_sync_state (
      entry_uuid TEXT PRIMARY KEY,
      last_synced_hash TEXT DEFAULT '',
      synced_at TEXT DEFAULT (datetime('now')),
      last_mutation_ts TEXT DEFAULT '',
      last_op_id TEXT DEFAULT '',
      last_client_id TEXT DEFAULT ''
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_tombstones (
      entry_uuid TEXT PRIMARY KEY,
      deleted_at TEXT DEFAULT '',
      deleted_by_client_id TEXT DEFAULT '',
      op_id TEXT DEFAULT ''
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      op_id TEXT PRIMARY KEY,
      client_id TEXT DEFAULT '',
      op_type TEXT DEFAULT '',
      entry_uuid TEXT DEFAULT '',
      mutation_ts TEXT DEFAULT '',
      payload_json TEXT DEFAULT '{}',
      artifact_path TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      attempt_count INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      last_attempt_at TEXT DEFAULT ''
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS applied_ops (
      op_id TEXT PRIMARY KEY,
      client_id TEXT DEFAULT '',
      op_type TEXT DEFAULT '',
      entry_uuid TEXT DEFAULT '',
      mutation_ts TEXT DEFAULT '',
      payload_json TEXT DEFAULT '{}',
      applied_at TEXT DEFAULT (datetime('now')),
      result TEXT DEFAULT ''
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_uuid TEXT DEFAULT '',
      local_hash TEXT DEFAULT '',
      shared_hash TEXT DEFAULT '',
      last_synced_hash TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      resolved INTEGER DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision TEXT DEFAULT '',
      entry_snapshot_hash TEXT DEFAULT '',
      import_issue_snapshot_hash TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      global_mutation_at TEXT DEFAULT ''
    )
  `);

  db.exec(`
    INSERT INTO sync_state (id, revision, global_mutation_at, updated_at)
    VALUES (1, '0', '', datetime('now'))
    ON CONFLICT(id) DO NOTHING
  `);
}

function addMissingColumns(db) {
  addColumnIfMissing(db, "applied_ops", "payload_json", "TEXT DEFAULT '{}'");
  addColumnIfMissing(db, "entry_sync_state", "last_mutation_ts", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "entry_sync_state", "last_op_id", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "entry_sync_state", "last_client_id", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "sync_state", "global_mutation_at", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "sync_state", "entry_snapshot_hash", "TEXT DEFAULT ''");
}

function normalizeEntryUuids(db) {
  if (!tableExists(db, "entries") || !columnExists(db, "entries", "entry_uuid")) {
    return;
  }

  const rows = db.prepare("SELECT entry_id, entry_uuid FROM entries ORDER BY entry_id").all();
  const seen = new Set();
  const updates = [];

  for (const row of rows) {
    const currentUuid = String(row.entry_uuid ?? "").trim();
    if (currentUuid && !seen.has(currentUuid)) {
      seen.add(currentUuid);
      continue;
    }

    let nextUuid = "";
    do {
      nextUuid = buildSqlUuid(db);
    } while (seen.has(nextUuid));
    seen.add(nextUuid);
    updates.push({ entryId: row.entry_id, entryUuid: nextUuid });
  }

  const statement = db.prepare("UPDATE entries SET entry_uuid = ? WHERE entry_id = ?");
  for (const update of updates) {
    statement.run(update.entryUuid, update.entryId);
  }
}

function buildSqlUuid(db) {
  const row = db.prepare("SELECT lower(hex(randomblob(16))) AS uuid").get();
  return String(row?.uuid ?? "");
}

function rebuildEntrySearchIndex(db) {
  dropVirtualTableIfExists(db, "equipment_search");
  dropVirtualTableIfExists(db, "entry_search");

  if (!tableExists(db, "entries")) {
    return;
  }

  db.exec(`
    CREATE VIRTUAL TABLE entry_search
    USING fts5(
      entry_id UNINDEXED,
      search_text,
      tokenize='trigram'
    )
  `);

  db.exec(`
    INSERT INTO entry_search(rowid, entry_id, search_text)
    SELECT
      entry_id,
      entry_id,
      ${ENTRY_SEARCH_TEXT_SQL}
    FROM entries
  `);
}

function rebuildEntrySearchTriggers(db) {
  db.exec("DROP TRIGGER IF EXISTS entries_ai_entry_search");
  db.exec("DROP TRIGGER IF EXISTS entries_au_entry_search");
  db.exec("DROP TRIGGER IF EXISTS entries_ad_entry_search");

  db.exec(`
    CREATE TRIGGER entries_ai_entry_search
    AFTER INSERT ON entries
    BEGIN
      INSERT OR REPLACE INTO entry_search(rowid, entry_id, search_text)
      VALUES (new.entry_id, new.entry_id, ${ENTRY_SEARCH_TEXT_TRIGGER_SQL("new")});
    END
  `);

  db.exec(`
    CREATE TRIGGER entries_au_entry_search
    AFTER UPDATE ON entries
    BEGIN
      INSERT OR REPLACE INTO entry_search(rowid, entry_id, search_text)
      VALUES (new.entry_id, new.entry_id, ${ENTRY_SEARCH_TEXT_TRIGGER_SQL("new")});
    END
  `);

  db.exec(`
    CREATE TRIGGER entries_ad_entry_search
    AFTER DELETE ON entries
    BEGIN
      DELETE FROM entry_search WHERE rowid = old.entry_id;
    END
  `);
}

const ENTRY_SEARCH_TEXT_SQL = `
  trim(
    coalesce(asset_number, '') || ' ' ||
    coalesce(serial_number, '') || ' ' ||
    coalesce(manufacturer, '') || ' ' ||
    coalesce(model, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(project_name, '') || ' ' ||
    coalesce(location, '') || ' ' ||
    coalesce(assigned_to, '') || ' ' ||
    coalesce(lifecycle_status, '') || ' ' ||
    coalesce(working_status, '') || ' ' ||
    coalesce(condition, '') || ' ' ||
    coalesce(links, '') || ' ' ||
    coalesce(notes, '')
  )
`;

function ENTRY_SEARCH_TEXT_TRIGGER_SQL(alias) {
  return `
    trim(
      coalesce(${alias}.asset_number, '') || ' ' ||
      coalesce(${alias}.serial_number, '') || ' ' ||
      coalesce(${alias}.manufacturer, '') || ' ' ||
      coalesce(${alias}.model, '') || ' ' ||
      coalesce(${alias}.description, '') || ' ' ||
      coalesce(${alias}.project_name, '') || ' ' ||
      coalesce(${alias}.location, '') || ' ' ||
      coalesce(${alias}.assigned_to, '') || ' ' ||
      coalesce(${alias}.lifecycle_status, '') || ' ' ||
      coalesce(${alias}.working_status, '') || ' ' ||
      coalesce(${alias}.condition, '') || ' ' ||
      coalesce(${alias}.links, '') || ' ' ||
      coalesce(${alias}.notes, '')
    )
  `;
}

function rebuildEntryIndexes(db) {
  const legacyIndexes = [
    "idx_equipment_archived",
    "idx_equipment_asset",
    "idx_equipment_cal",
    "idx_equipment_lifecycle",
    "idx_equipment_record_uuid",
    "idx_equipment_serial",
    "idx_equipment_tombstones_deleted_at",
    "idx_applied_ops_record_uuid",
    "idx_sync_outbox_record_uuid",
  ];

  for (const indexName of legacyIndexes) {
    db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`);
  }

  if (tableExists(db, "entries")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_archived ON entries(is_archived)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_asset ON entries(asset_number)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_cal ON entries(calibration_status)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_entry_uuid ON entries(entry_uuid)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_lifecycle ON entries(lifecycle_status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_location ON entries(location)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_manufacturer ON entries(manufacturer)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_model ON entries(model)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_name)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_serial ON entries(serial_number)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated_at DESC, entry_id DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_verified ON entries(verified_in_survey)");
  }

  if (tableExists(db, "entry_tombstones")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_entry_tombstones_deleted_at ON entry_tombstones(deleted_at)");
  }

  if (tableExists(db, "applied_ops")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_applied_ops_entry_uuid ON applied_ops(entry_uuid)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_applied_ops_mutation ON applied_ops(mutation_ts, op_id)");
  }

  if (tableExists(db, "sync_outbox")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_sync_outbox_entry_uuid ON sync_outbox(entry_uuid)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created ON sync_outbox(status, created_at)");
  }
}

function seedEntrySyncState(db) {
  if (!tableExists(db, "entries") || !tableExists(db, "entry_sync_state")) {
    return;
  }

  db.exec(`
    INSERT INTO entry_sync_state (
      entry_uuid,
      last_synced_hash,
      synced_at,
      last_mutation_ts,
      last_op_id,
      last_client_id
    )
    SELECT
      entry_uuid,
      '',
      datetime('now'),
      coalesce(updated_at, ''),
      '',
      ''
    FROM entries
    WHERE trim(coalesce(entry_uuid, '')) <> ''
    ON CONFLICT(entry_uuid) DO UPDATE SET
      last_mutation_ts = CASE
        WHEN trim(entry_sync_state.last_mutation_ts) = '' THEN excluded.last_mutation_ts
        ELSE entry_sync_state.last_mutation_ts
      END
  `);
}

function renameTableIfNeeded(db, oldName, newName) {
  if (!tableExists(db, oldName) || tableExists(db, newName)) {
    return;
  }

  db.exec(`ALTER TABLE ${quoteIdentifier(oldName)} RENAME TO ${quoteIdentifier(newName)}`);
}

function renameColumnIfNeeded(db, tableName, oldName, newName) {
  if (!tableExists(db, tableName) || !columnExists(db, tableName, oldName) || columnExists(db, tableName, newName)) {
    return;
  }

  db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldName)} TO ${quoteIdentifier(newName)}`);
}

function addColumnIfMissing(db, tableName, columnName, columnDefinition) {
  if (!tableExists(db, tableName) || columnExists(db, tableName, columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnDefinition}`);
}

function dropVirtualTableIfExists(db, tableName) {
  if (!tableExists(db, tableName)) {
    return;
  }

  db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view') AND name = ? LIMIT 1")
    .get(tableName);
  return Boolean(row);
}

function triggerExists(db, triggerName) {
  const row = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name = ? LIMIT 1")
    .get(triggerName);
  return Boolean(row);
}

function columnExists(db, tableName, columnName) {
  if (!tableExists(db, tableName)) {
    return false;
  }

  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().some((column) => column.name === columnName);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
