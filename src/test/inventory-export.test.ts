/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_DB_PATH = path.resolve("data", "me_inventory.db");

interface RuntimeContext {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
}

interface ExportModule {
  DEFAULT_EXCEL_EXPORT_FILENAME: string;
  exportExcelInventory: (args: {
    defaultDirectoryPath: string;
    runtimeContext: RuntimeContext;
    showMessageBox?: (options: { message: string; title: string; type: "error" | "info" }) => Promise<void> | void;
    showSaveDialog: (options: {
      defaultPath: string;
      filters: Array<{ name: string; extensions: string[] }>;
      properties: string[];
      title: string;
    }) => Promise<{ canceled: boolean; filePath?: string }>;
  }) => Promise<{
    canceled: boolean;
    error?: string;
    outputPath?: string;
  }>;
  writeInventoryWorkbook: (runtimeContext: RuntimeContext, outputPath: string) => Promise<{
    archiveCount: number;
    inventoryCount: number;
    outputPath: string;
    totalCount: number;
  }>;
}

describe("inventory Excel export", () => {
  let exportModule: ExportModule;
  let tempDir: string;
  let runtimeContext: RuntimeContext;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ims-export-"));
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
    fs.copyFileSync(PROJECT_DB_PATH, path.join(tempDir, "data", "me_inventory.db"));
    runtimeContext = {
      appPath: tempDir,
      isPackaged: false,
      resourcesPath: "",
      userDataPath: "",
    };
    exportModule = (await import(pathToFileURL(path.resolve("electron/inventory-export.mjs")).href)) as ExportModule;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a Python-style workbook with inventory, import issue, and summary sheets", async () => {
    const outputPath = path.join(tempDir, "ME_Inventory_Export.xlsx");
    const workbook = new ExcelJS.Workbook();
    const db = new DatabaseSync(path.join(tempDir, "data", "me_inventory.db"), { readOnly: true });

    const archivedRow = db.prepare("SELECT description FROM entries WHERE is_archived = 1 LIMIT 1").get();
    const activeRow = db.prepare("SELECT description FROM entries WHERE is_archived = 0 LIMIT 1").get();
    const counts = db
      .prepare(
        `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) AS archived,
            SUM(CASE WHEN verified_in_survey = 1 THEN 1 ELSE 0 END) AS verified
          FROM entries
        `,
      )
      .get();
    db.close();

    expect(activeRow).toBeTruthy();
    expect(archivedRow).toBeTruthy();
    expect(counts).toBeTruthy();

    const activeDescription = String(activeRow?.description ?? "");
    const archivedDescription = String(archivedRow?.description ?? "");
    const totalCount = Number(counts?.total ?? 0);
    const archivedCount = Number(counts?.archived ?? 0);
    const verifiedCount = Number(counts?.verified ?? 0);

    await exportModule.writeInventoryWorkbook(runtimeContext, outputPath);
    await workbook.xlsx.readFile(outputPath);

    const inventorySheet = workbook.getWorksheet("Inventory");
    const issueSheet = workbook.getWorksheet("Import Issues");
    const summarySheet = workbook.getWorksheet("Export Summary");

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Inventory", "Import Issues", "Export Summary"]);
    expect(workbook.getWorksheet("Archive")).toBeUndefined();
    expect(inventorySheet).toBeDefined();
    expect(issueSheet).toBeDefined();
    expect(summarySheet).toBeDefined();
    expect(inventorySheet?.getRow(1).values).toContain("Archived");
    expect(issueSheet?.getRow(1).values).toContain("Summary");
    expect(getWorksheetText(inventorySheet)).toContain(activeDescription);
    expect(getWorksheetText(inventorySheet)).toContain(archivedDescription);
    expect(getSummaryValue(summarySheet, "Total Entries")).toBe(totalCount);
    expect(getSummaryValue(summarySheet, "Inventory View Entries")).toBe(totalCount - archivedCount);
    expect(getSummaryValue(summarySheet, "Archived Entries")).toBe(archivedCount);
    expect(getSummaryValue(summarySheet, "Verified")).toBe(verifiedCount);
    expect(getSummaryValue(summarySheet, "Master List")).toBe("Machine Shop Material list.xlsx");
  });

  it("exports with an empty import issues sheet when the optional table is missing", async () => {
    const outputPath = path.join(tempDir, "ME_Inventory_No_Issues_Table.xlsx");
    const workbook = new ExcelJS.Workbook();
    const db = new DatabaseSync(path.join(tempDir, "data", "me_inventory.db"));
    try {
      db.exec("DROP TABLE import_issues");
    } finally {
      db.close();
    }

    await exportModule.writeInventoryWorkbook(runtimeContext, outputPath);
    await workbook.xlsx.readFile(outputPath);

    const issueSheet = workbook.getWorksheet("Import Issues");
    expect(issueSheet).toBeDefined();
    expect(issueSheet?.rowCount).toBe(1);
    expect(issueSheet?.getRow(1).values).toContain("Summary");
  });

  it("returns a canceled result when the save dialog is dismissed", async () => {
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true });

    const result = await exportModule.exportExcelInventory({
      defaultDirectoryPath: tempDir,
      runtimeContext,
      showSaveDialog,
    });

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ canceled: true });
  });

  it("uses the ME export filename by default", async () => {
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true });

    await exportModule.exportExcelInventory({
      defaultDirectoryPath: tempDir,
      runtimeContext,
      showSaveDialog,
    });

    expect(showSaveDialog.mock.calls[0][0].defaultPath).toBe(
      path.join(tempDir, exportModule.DEFAULT_EXCEL_EXPORT_FILENAME),
    );
  });

  it("returns a structured error when export writing fails", async () => {
    const showMessageBox = vi.fn().mockResolvedValue(undefined);
    const result = await exportModule.exportExcelInventory({
      defaultDirectoryPath: tempDir,
      runtimeContext,
      showMessageBox,
      showSaveDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: path.join(tempDir, "missing", "ME_Inventory_Export.xlsx"),
      }),
    });

    expect(result.canceled).toBe(false);
    expect(result.error).toBeTruthy();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });
});

function getWorksheetText(worksheet: ExcelJS.Worksheet | undefined): string {
  if (!worksheet) {
    return "";
  }

  return worksheet.getSheetValues().flat().filter(Boolean).join(" ");
}

function getSummaryValue(worksheet: ExcelJS.Worksheet | undefined, label: string): number | string | null {
  if (!worksheet) {
    return null;
  }

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const labelCell = worksheet.getRow(rowIndex).getCell(1).value;
    if (labelCell === label) {
      return worksheet.getRow(rowIndex).getCell(2).value as number | string | null;
    }
  }

  return null;
}
