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
export const INVENTORY_SCHEMA_VERSION = 1;

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
    columnExists(db, "entries", "entry_id") &&
    columnExists(db, "entries", "entry_uuid") &&
    tableExists(db, "entry_search") &&
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

  rebuildEntrySearchIndex(db);
  rebuildEntryIndexes(db);
}

function rebuildEntrySearchIndex(db) {
  dropVirtualTableIfExists(db, "equipment_search");

  if (!tableExists(db, "entries")) {
    return;
  }

  if (tableExists(db, "entry_search") && !columnExists(db, "entry_search", "entry_id")) {
    dropVirtualTableIfExists(db, "entry_search");
  }

  if (!tableExists(db, "entry_search")) {
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
      FROM entries
    `);
  }
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
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_lifecycle ON entries(lifecycle_status)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_entry_uuid ON entries(entry_uuid)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_serial ON entries(serial_number)");
  }

  if (tableExists(db, "entry_tombstones")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_entry_tombstones_deleted_at ON entry_tombstones(deleted_at)");
  }

  if (tableExists(db, "applied_ops") && columnExists(db, "applied_ops", "entry_uuid")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_applied_ops_entry_uuid ON applied_ops(entry_uuid)");
  }

  if (tableExists(db, "sync_outbox") && columnExists(db, "sync_outbox", "entry_uuid")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_sync_outbox_entry_uuid ON sync_outbox(entry_uuid)");
  }
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

function columnExists(db, tableName, columnName) {
  if (!tableExists(db, tableName)) {
    return false;
  }

  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().some((column) => column.name === columnName);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
