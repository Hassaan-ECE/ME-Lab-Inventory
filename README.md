# IMS T3 Code Reference Design

Electron desktop app that recreates the `ME_lab` main inventory window from `D:\coding\Inventory_Management_System` using the T3 Code visual language described in `D:\coding\t3code_design\README.md`.

## Scope

- Main inventory window only
- Electron desktop shell, not a browser-only app
- Bundled `data/me_lab_inventory.db` from the ME lab system
- Inventory / Archive switching
- Search, column filters, sorting, column visibility, verified toggle
- Mock action feedback for import/export/add flows

Out of scope in this prototype:

- shared sync
- add/edit dialogs
- real import/export
- TE/Template variants

## Scripts

```bash
npm install
npm run dev
npm run dev:desktop
npm run start:desktop
npm run build
npm run build:desktop
npm run lint
npm run test
```

## Notes

- `npm run dev:desktop` starts the Vite dev server and opens the Electron desktop window.
- `npm run build:desktop` produces a Windows installer in `release/`.
- The desktop app reads from `data/me_lab_inventory.db` in development and ships that database inside the Windows build.
- Packaged builds copy the bundled database into the app's writable Electron `userData` directory on first launch.
- Verified toggles write back to that local desktop database copy.
- The app persists theme, color-row preference, and column visibility in `localStorage`.
- Status messages explicitly call out when an action is visual-only.
- The UI uses DM Sans and tokenized surfaces based on the T3 reference shell rather than the original PySide6 styling.
- The current Windows package uses the default Electron icon because no custom `.ico` asset has been added yet.
