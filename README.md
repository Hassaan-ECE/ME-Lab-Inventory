# ME Inventory

ME Inventory is an Electron desktop application for managing ME lab inventory entries. It uses a SQLite-backed local cache, optional shared-drive synchronization, archive handling, searchable/sortable tables, entry editing, and Excel export.

Current app display name: `ME Inventory v0.9.5`.

## Current Status

Implemented:

- standalone Electron desktop shell
- bundled ME inventory seed database
- inventory and archive views
- global entry search and column filters
- sortable table columns
- column visibility controls
- visible Color Rows toggle state
- verified-in-survey toggle
- add, edit, archive, restore, and delete entry flows
- right-click entry context menu
- full entry editor with picture path and preview support
- native Excel export
- shared SQLite synchronization with local offline mutation fallback
- legacy database filename and schema migration
- persisted theme, Color Rows, and column visibility preferences
- shared-drive update check, background download, checksum verification, and installer handoff

Not implemented yet:

- importing from Excel or another database
- HTML export generation
- quick-edit dialog parity with the original Python app
- TE / template variants

## App Behavior

### Main Window

The main window is fixed and does not scroll as a whole. The entry table area scrolls internally.

Primary actions:

- `Add Entry`
- `Export` menu with `Excel` and placeholder `HTML`
- light/dark theme toggle
- `Inventory` / `Archive` scope switching
- `Filters`, `Color Rows`, and `Columns` controls

Table behavior:

- active entries show in `Inventory`; archived entries show in `Archive`
- global search and column filters combine together
- rows can be sorted by header click
- visible columns can be toggled while preserving at least one data column
- verified state can be toggled from the table
- double-click opens the full entry editor
- right-click opens entry actions

Result labels use entry terminology:

- `Showing all N entries`
- `Showing N filtered entries`
- `Showing all N archived entries`
- `No archived entries yet`

Search placeholders:

- Inventory: `Search entries by asset, serial, maker, model, description, location, status, or notes`
- Archive: `Search archived entries by asset, serial, maker, model, description, location, or notes`

### Entry Context Menu

Right-clicking an entry opens actions for:

- `Open Full Entry`
- `Open Saved Link` when the entry has a stored link
- `Search Online`
- `Archive Entry` or `Restore Entry`
- `Delete Entry`

Archive and restore actions run immediately and report completion in the status strip. Delete uses an in-app confirmation dialog to prevent accidental removal.

### Full Entry Dialog

The full entry dialog is used for both add and edit flows.

Supported editable fields:

- asset number
- serial / internal ID
- manufacturer / brand
- model / part number
- quantity
- project
- description
- location
- used by / assigned to
- links
- picture path
- lifecycle
- working status
- condition
- notes
- verified in survey
- archived entry

On large edit layouts, the sidebar contains entry metadata plus fixed `Cancel` and `Save Entry` actions so the buttons remain reachable at the default window size.

Native dropdowns remain in use for lifecycle and working status. Dark mode explicitly styles both the collapsed select control and the dropdown options so the popup does not render white text on a white background.

## Data Model And Storage

### Local Database

During development, the app reads from:

- `data/me_inventory.db`

Packaged desktop builds copy the bundled database into Electron's writable `userData` directory and use that file as the local cache.

The current SQLite schema uses entry terminology:

- primary table: `entries`
- primary key: `entry_id`
- stable sync key: `entry_uuid`
- tombstones: `entry_tombstones`
- sync metadata: `entry_sync_state`
- snapshot hash: `sync_state.entry_snapshot_hash`

The bundled seed currently contains the migrated ME inventory data and is the source used for first-run local cache creation. It is not the live installed database once the app is packaged and launched.

### Legacy Compatibility

The app keeps compatibility with old DB names and schema names:

- old local DB: `data/me_lab_inventory.db`
- old shared DB: `<shared root>\shared\me_lab_shared.db`
- old schema/table names such as `equipment`, `record_id`, and `record_uuid`

On startup, when a new DB is missing but an old DB exists, the app copies the old DB to the new filename, migrates the copy to the entry schema, sets `PRAGMA user_version = 1`, and leaves the old DB in place as a compatibility backup.

### Shared Workspace

Shared database defaults:

- default shared root: `S:\Manufacturing\Internal\_Syed_H_Shah\InventoryApps\ME`
- default shared database: `<shared root>\shared\me_inventory_shared.db`
- override env var: `ME_LAB_SHARED_ROOT`

The desktop bridge reports shared state through `InventorySharedStatus`:

- `available`: whether the shared root is currently reachable
- `canModify`: whether entry actions should be enabled
- `mutationMode`: `shared` or `local`
- `hasLocalOnlyChanges`: whether the local cache has unsynced local writes
- `revision`: current numeric sync revision

When shared storage is available, mutations write to the shared DB first, then refresh the local cache from shared.

When shared storage is unavailable or unconfigured, the app stays editable. Add, edit, verified, archive, restore, and delete actions write to the local DB, increment local `sync_state.revision`, and show local-only status copy such as:

- `Shared workspace unavailable. Saving changes locally.`
- `Entry added locally.`
- `Entry updated locally.`
- `Verified state updated locally.`

When shared storage becomes available again, sync compares local and shared numeric revisions:

- if local revision is newer, local DB is copied to shared
- if shared revision is newer or equal, shared DB is copied to local
- no conflict UI is implemented; revision wins

Idle shared syncs are read-only when local and shared revisions have not changed. The app does not rewrite either SQLite file, reload all entries, or repaint the table unless the shared or local entry data actually changes.

## Shared Updates

The desktop app checks the shared update manifest at:

- `S:\Manufacturing\Internal\_Syed_H_Shah\InventoryApps\ME\current.json`

When the manifest advertises a newer version than the running app, the app automatically copies the installer to the local app data update cache in the background and verifies the manifest SHA-256. A blue status button appears beside the `ME Inventory` title while this happens. After the download is verified, the button changes to `Install update`; clicking it starts a handoff helper, closes the app only after that helper is running, opens the normal visible installer, and reopens the installed app after the installer exits.

The shared `0.9.5` installer path is the active release channel. Users stuck on a broken `0.9.5` updater should run that installer manually once to move onto the fixed updater build.

## Excel Export

`Export > Excel` is implemented in the Electron main process.

Behavior:

- opens a native save dialog
- defaults to `ME_Inventory_Export.xlsx`
- exports all entries, not just currently visible filtered rows
- keeps active and archived entries together in the main `Inventory` sheet with an `Archived` column
- writes `Inventory`, `Import Issues`, and `Export Summary` sheets

Export summary labels use entry terminology:

- `ME Inventory - Export Summary`
- `Entry Scope`
- `Total Entries`
- `Inventory View Entries`
- `Archived Entries`

The workbook keeps the existing print-friendly styling:

- styled header row
- zebra striping
- borders
- frozen top row
- autofilter
- landscape print setup
- status-based cell fills where applicable

## UI Preferences

The following preferences are stored in `localStorage`:

- `meInventory.theme`
- `meInventory.colorRows`
- `meInventory.columnVisibility`

The Color Rows toggle uses a visible selected state with primary background, border, foreground, and shadow while preserving the row-color behavior.

Text inputs use an explicit inner stacking layer so the decorative input wrapper cannot interfere with focus or typing.

The app version is sourced from `package.json` and shared across the renderer header, document title, Electron window title, and packaging metadata.

## Scripts

Install dependencies:

```bash
npm install
```

Run the browser-only Vite dev server:

```bash
npm run dev
```

Run the real desktop app in development:

```bash
npm run dev:desktop
```

Open Electron against the current built files:

```bash
npm run start:desktop
```

Build the renderer:

```bash
npm run build
```

Create the Windows desktop installer:

```bash
npm run build:desktop
```

Run lint:

```bash
npm run lint
```

Run tests:

```bash
npm run test
```

## Packaging

The app is packaged with `electron-builder`.

Current packaging notes:

- Windows target: NSIS
- output directory: `release/`
- packaged product name: `ME Inventory`
- app id: `com.syedhassaan.me-inventory`
- package name: `me-inventory`
- version: `0.9.5`
- the database is included through `extraResources`
- the app, installer, and executable use `electron/assets/app_icon.ico`

Typical packaged output:

- `release/ME Inventory Setup 0.9.5.exe`

## Repository Layout

High-value paths:

- `src/branding.ts`
  Shared app name and version source.

- `src/components/inventory/InventoryShell.tsx`
  Main inventory screen state, desktop bridge integration, local/offline edit behavior, sync status display, and table/dialog orchestration.

- `src/components/inventory/EntryDialog.tsx`
  Add/edit full entry dialog, picture preview, lifecycle/status selects, and dialog-level validation.

- `src/components/inventory/EntryContextMenu.tsx`
  Right-click row actions.

- `src/components/inventory/InventoryTable.tsx`
  Table rendering, row coloring, sorting hooks, double-click editing, and verified toggle.

- `src/lib/inventory.ts`
  Filtering, sorting, result labels, column visibility, and link formatting helpers.

- `src/types/inventory.ts`
  Inventory entry types and shared status interface.

- `electron/inventory-runtime.mjs`
  DB path resolution, legacy filename migration, and schema migration.

- `electron/inventory-db.mjs`
  SQLite load, CRUD, shared sync, local offline mutation fallback, and revision handling.

- `electron/inventory-export.mjs`
  Excel export generation.

- `data/me_inventory.db`
  Migrated bundled seed database.

## Testing

Automated coverage includes:

- app name and version display
- absence of prototype/stage labeling
- inventory/archive view switching
- entry search placeholder copy
- search and filter behavior
- entry add and edit flows
- text entry into dialog fields
- row context menu behavior
- Color Rows toggle selected styling and row-color behavior
- dark-mode dropdown select/option styling
- Excel export workbook generation and entry summary labels
- legacy DB migration from `equipment` / `record_*` schema to `entries` / `entry_*`
- shared database bootstrap and sync behavior
- local-only desktop mutations when shared storage is unavailable
- pushing newer local-only changes to shared when storage reconnects
- desktop bridge export invocation

Main test files:

- `src/test/inventory-shell.test.tsx`
- `src/test/inventory-entry-actions.test.tsx`
- `src/test/entry-dialog.test.tsx`
- `src/test/inventory-export.test.ts`
- `src/test/inventory-filtering.test.ts`
- `src/test/inventory-table.test.tsx`
- `src/test/inventory-db.test.ts`

Current validation commands:

```bash
npm run test
npm run build
```

## Contributor Notes

- Treat `data/me_inventory.db` as the current bundled seed source.
- Do not delete legacy `data/me_lab_inventory.db`; it remains a compatibility backup/source.
- `data/me_inventory.db-wal`, `data/me_inventory.db-shm`, old `data/me_lab_inventory.db-wal`, and old `data/me_lab_inventory.db-shm` are runtime artifacts and are ignored.
- Avoid treating the repo database as the live installed database.
- If you change desktop behavior, validate through Electron when practical, not only `npm run dev`.
