# ME Lab Inventory Prototype

Desktop inventory application for the ME lab, rebuilt from the original Python app in `D:\coding\Inventory_Management_System` with a T3-inspired visual system from `D:\coding\t3code_design`.

This repository is no longer just a browser prototype. It is an Electron desktop app with a shared SQLite-backed workflow and a local cache for manual record management.

## Current Status

Implemented:

- standalone Electron desktop shell
- bundled ME inventory database
- inventory and archive views
- global search
- column filters
- sortable table columns
- column visibility controls
- verified toggle
- add record
- full record edit on double click
- row context menu actions
- archive and restore
- delete record
- single export menu
- Python-style Excel export
- placeholder HTML export menu item
- shared authoritative database sync
- persisted theme and table preferences

Intentionally not implemented yet:

- importing from Excel or another database
- HTML export generation
- quick edit dialog parity with the Python app
- image/file browsing inside the full record dialog
- updater flow redesign
- TE / template variants

## App Behavior

### Main window

The main window is fixed and does not scroll as a whole. The records area scrolls internally.

Primary actions:

- `Add Record`
- `Export` menu with `Excel` and placeholder `HTML`
- theme toggle
- `Inventory` / `Archive` view switching

Table behavior:

- only the record area scrolls
- rows can be sorted by header click
- global search and column filters combine together
- verified state can be toggled from the table
- double-click opens the full record editor
- right-click opens the row action menu

Row action menu:

- `Open Full Record`
- `Open Saved Link` when the row has a stored link
- `Search Online`
- `Archive Record` or `Restore Record`
- `Delete Record`

### Full record dialog

The full record dialog is used for both add and edit flows.

Supported editable fields:

- asset number
- serial / internal ID
- manufacturer
- model
- quantity
- project
- description
- location
- assigned to
- links
- lifecycle
- working status
- condition
- notes
- verified in survey
- archived record

On large edit layouts, the sidebar contains record metadata plus the fixed `Cancel` and `Save Record` actions so the buttons remain reachable at the default window size.

## Data Model and Storage

### Development

During development, the app reads from:

- `data/me_lab_inventory.db`

When the shared workspace is reachable, this repo-local database acts as a local cache. The authoritative shared database is:

- default shared root: `S:\Manufacturing\Internal\_Syed_H_Shah\InventoryApps\ME`
- default shared database: `<shared root>\shared\me_lab_shared.db`
- override env var: `ME_LAB_SHARED_ROOT`

On startup, the app loads the local cache first, then refreshes it from the shared database. If the shared root is reachable but the shared database is missing or empty, the app bootstraps the shared database from the local seed. If shared storage is unavailable, the app remains open for view/search/export, but record mutations are disabled.

### Packaged desktop builds

Packaged builds ship the bundled database as an application resource. On first launch, the app copies that database into Electron's writable `userData` directory and uses that file as the local cache.

That means:

- connected edits write to the shared authoritative database first
- the local cache is refreshed from shared after sync and write cycles
- verified toggles, add, edit, archive, restore, and delete actions are real shared-backed database operations
- the bundled source database in the repo is the seed, not the live installed database

Relevant Electron files:

- `electron/main.mjs`
- `electron/preload.mjs`
- `electron/inventory-db.mjs`
- `electron/inventory-runtime.mjs`

## Excel Export

`Export > Excel` is implemented in the Electron main process, not in the renderer.

Behavior:

- opens a native save dialog
- defaults to `ME_Lab_Inventory_Export.xlsx`
- exports all records, not just the currently visible filtered rows
- keeps active and archived records together in the main sheet with an `Archived` column
- follows the Python app's workbook structure and print-friendly styling

Workbook sheets:

1. `Inventory`
2. `Import Issues`
3. `Export Summary`

Export summary includes:

- total record count
- inventory count
- archived count
- lifecycle counts
- calibration counts
- verified count
- unresolved import issue count

Export formatting includes:

- styled header row
- zebra striping
- borders
- frozen top row
- autofilter
- landscape print setup
- status-based cell fills where applicable

Relevant export files:

- `electron/inventory-export.mjs`
- `src/test/inventory-export.test.ts`

## UI Notes

The app keeps the ME lab terminology and workflow structure, but the visual layer is based on the T3 reference system:

- DM Sans typography
- tokenized colors and surfaces
- rounded card layout
- badge-based status treatments
- green `Inventory` tab styling
- amber `Archive` tab styling

Preferences persisted in `localStorage`:

- theme
- color row toggle
- column visibility

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
- packaged product name: `ME Lab Inventory Prototype`
- the database is included through `extraResources`
- the app, installer, and executable now use `electron/assets/app_icon.ico`

Typical packaged output:

- `release/ME Lab Inventory Prototype Setup 0.1.0.exe`

## Repository Layout

High-value paths:

- `src/components/inventory/InventoryPrototype.tsx`
  main inventory screen state and orchestration
- `src/components/inventory/InventoryHeader.tsx`
  top bar actions and inventory/archive tabs
- `src/components/inventory/InventoryTable.tsx`
  table rendering and row interactions
- `src/components/inventory/RecordDialog.tsx`
  add/edit full record dialog
- `src/components/inventory/RecordContextMenu.tsx`
  right-click row actions
- `src/lib/inventory.ts`
  filtering, sorting, and table helpers
- `src/types/inventory.ts`
  inventory record types
- `electron/main.mjs`
  Electron app startup and IPC registration
- `electron/preload.mjs`
  renderer bridge
- `electron/inventory-db.mjs`
  SQLite CRUD operations
- `electron/inventory-export.mjs`
  Excel export generation
- `data/me_lab_inventory.db`
  bundled seed database

## Testing

Automated coverage currently includes:

- inventory shell rendering
- view switching
- search and filter behavior
- record add and edit flows
- row context menu behavior
- Excel export workbook generation
- shared database bootstrap and sync behavior
- desktop bridge export invocation

Main test files:

- `src/test/inventory-shell.test.tsx`
- `src/test/inventory-record-actions.test.tsx`
- `src/test/inventory-export.test.ts`
- `src/test/inventory-filtering.test.ts`
- `src/test/inventory-table.test.tsx`
- `src/test/inventory-db.test.ts`

## Known Gaps

These are still open relative to the original Python app:

- HTML export is still a placeholder
- no import workflow exists anymore by design
- no quick-edit dialog from the row context menu
- no image browse / preview inside the record editor
- no update delivery flow yet

## Notes for Contributors

- `data/me_lab_inventory.db-wal` and `data/me_lab_inventory.db-shm` are runtime artifacts and are ignored
- avoid treating the repo database as the live installed database
- if you change desktop behavior, test through Electron, not only `npm run dev`
