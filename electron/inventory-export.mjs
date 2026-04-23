import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import ExcelJS from "exceljs";

import { resolveDbPath } from "./inventory-runtime.mjs";

export const DEFAULT_EXCEL_EXPORT_FILENAME = "ME_Lab_Inventory_Export.xlsx";

const WHITE = "FFFFFF";
const OFF_WHITE = "F9FAFB";
const BAND = "F3F4F6";
const BORDER_COLOR = "D1D5DB";
const HEADER_BG = "1F2937";
const SECTION_BG = "E5E7EB";

const THIN_BORDER = {
  top: { style: "thin", color: { argb: BORDER_COLOR } },
  left: { style: "thin", color: { argb: BORDER_COLOR } },
  bottom: { style: "thin", color: { argb: BORDER_COLOR } },
  right: { style: "thin", color: { argb: BORDER_COLOR } },
};
const HEADER_BORDER = {
  top: { style: "thin", color: { argb: "374151" } },
  left: { style: "thin", color: { argb: "374151" } },
  bottom: { style: "medium", color: { argb: "374151" } },
  right: { style: "thin", color: { argb: "374151" } },
};

const EXPORT_COLUMNS = [
  { header: "Asset Number", key: "asset_number", width: 16, align: "left" },
  { header: "Serial Number", key: "serial_number", width: 20, align: "left" },
  { header: "Manufacturer", key: "manufacturer", width: 18, align: "left" },
  { header: "Model", key: "model", width: 16, align: "left" },
  { header: "Description", key: "description", width: 32, align: "left", wrap: true },
  { header: "Project", key: "project_name", width: 20, align: "left" },
  { header: "Location", key: "location", width: 24, align: "left" },
  { header: "Links", key: "links", width: 28, align: "left", wrap: true },
  { header: "Assigned To", key: "assigned_to", width: 14, align: "left" },
  { header: "Lifecycle", key: "lifecycle_status", width: 13, align: "center", format: "lifecycle" },
  { header: "Working", key: "working_status", width: 13, align: "center", format: "working" },
  { header: "Condition", key: "condition", width: 22, align: "left", wrap: true },
  { header: "Cal Status", key: "calibration_status", width: 15, align: "center", format: "calibration" },
  { header: "Last Cal Date", key: "last_calibration_date", width: 14, align: "center" },
  { header: "Cal Due Date", key: "calibration_due_date", width: 14, align: "center" },
  { header: "Cal Vendor", key: "calibration_vendor", width: 16, align: "left" },
  { header: "Cal Cost", key: "calibration_cost", width: 11, align: "right", format: "currency" },
  { header: "Ownership", key: "ownership_type", width: 12, align: "center" },
  { header: "Rental Vendor", key: "rental_vendor", width: 14, align: "left" },
  { header: "Rental Cost/Mo", key: "rental_cost_monthly", width: 14, align: "right", format: "currency" },
  { header: "Verified", key: "verified_in_survey", width: 14, align: "center", format: "boolean" },
  { header: "Blue Dot", key: "blue_dot_ref", width: 10, align: "center" },
  { header: "Est. Age (Yrs)", key: "estimated_age_years", width: 13, align: "center", format: "number" },
  { header: "Notes", key: "notes", width: 40, align: "left", wrap: true },
];

const SELECT_EXPORT_SQL = `
  SELECT
    record_id,
    asset_number,
    serial_number,
    manufacturer,
    model,
    description,
    project_name,
    location,
    links,
    assigned_to,
    lifecycle_status,
    working_status,
    condition,
    calibration_status,
    last_calibration_date,
    calibration_due_date,
    calibration_vendor,
    calibration_cost,
    ownership_type,
    rental_vendor,
    rental_cost_monthly,
    verified_in_survey,
    blue_dot_ref,
    estimated_age_years,
    notes,
    is_archived,
    updated_at
  FROM equipment
  ORDER BY is_archived ASC, updated_at DESC, record_id DESC
`;

export async function exportExcelInventory({
  defaultDirectoryPath,
  runtimeContext,
  showMessageBox,
  showSaveDialog,
}) {
  const saveResult = await showSaveDialog({
    defaultPath: path.join(defaultDirectoryPath, DEFAULT_EXCEL_EXPORT_FILENAME),
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
    title: "Export All Equipment to Excel",
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  try {
    await writeInventoryWorkbook(runtimeContext, saveResult.filePath);

    if (showMessageBox) {
      await showMessageBox({
        message: `All equipment data exported to:\n${saveResult.filePath}`,
        title: "Export Complete",
        type: "info",
      });
    }

    return {
      canceled: false,
      outputPath: saveResult.filePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown export error.";

    if (showMessageBox) {
      await showMessageBox({
        message: `Export failed:\n${errorMessage}`,
        title: "Export Error",
        type: "error",
      });
    }

    return {
      canceled: false,
      error: errorMessage,
    };
  }
}

export async function writeInventoryWorkbook(runtimeContext, outputPath) {
  const rows = loadExportRows(runtimeContext);
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Syed Hassaan Shah";
  workbook.created = new Date();
  workbook.modified = new Date();

  const inventoryRows = rows.filter((row) => !Boolean(row.is_archived));
  const archiveRows = rows.filter((row) => Boolean(row.is_archived));
  const summaryStats = buildSummaryStats(rows);

  const inventorySheet = workbook.addWorksheet("Inventory");
  const archiveSheet = workbook.addWorksheet("Archive");
  const summarySheet = workbook.addWorksheet("Export Summary");

  buildInventorySheet(inventorySheet, inventoryRows);
  buildInventorySheet(archiveSheet, archiveRows);
  buildSummarySheet(summarySheet, summaryStats);

  await workbook.xlsx.writeFile(outputPath);

  return {
    archiveCount: archiveRows.length,
    inventoryCount: inventoryRows.length,
    outputPath,
    totalCount: rows.length,
  };
}

function loadExportRows(runtimeContext) {
  const dbPath = resolveDbPath(runtimeContext);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    return db.prepare(SELECT_EXPORT_SQL).all();
  } finally {
    db.close();
  }
}

function buildInventorySheet(worksheet, rows) {
  worksheet.properties.defaultRowHeight = 20;
  worksheet.pageSetup = {
    fitToHeight: 0,
    fitToPage: true,
    fitToWidth: 1,
    orientation: "landscape",
  };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = HEADER_BORDER;
    cell.fill = { fgColor: { argb: HEADER_BG }, pattern: "solid", type: "pattern" };
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
  });

  rows.forEach((row, index) => {
    const worksheetRow = worksheet.addRow(
      EXPORT_COLUMNS.map((column) => formatCellValue(row[column.key], column.format)),
    );
    const isEvenRow = index % 2 === 0;
    const bandColor = isEvenRow ? OFF_WHITE : BAND;

    worksheetRow.eachCell((cell, columnNumber) => {
      const column = EXPORT_COLUMNS[columnNumber - 1];
      const style = getCellStyle(row, column, bandColor);

      cell.alignment = style.alignment;
      cell.border = THIN_BORDER;
      cell.fill = style.fill;
      cell.font = style.font;
      if (style.numFmt) {
        cell.numFmt = style.numFmt;
      }
    });
  });

  worksheet.autoFilter = {
    from: { column: 1, row: 1 },
    to: { column: EXPORT_COLUMNS.length, row: Math.max(1, rows.length + 1) },
  };
}

function buildSummarySheet(worksheet, stats) {
  worksheet.properties.defaultRowHeight = 20;
  worksheet.columns = [
    { width: 32 },
    { width: 52 },
  ];

  const titleRow = worksheet.getRow(1);
  worksheet.mergeCells("A1:B1");
  titleRow.getCell(1).value = "ME Lab Inventory — Export Summary";
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "1F2937" } };

  worksheet.getCell("A2").value = `Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
  worksheet.getCell("A2").font = { size: 11, color: { argb: "6B7280" } };

  let row = 4;
  row = writeSummarySection(worksheet, row, "Export Details", [["Record Scope", "All records (Inventory + Archive)"]]);
  row += 1;
  row = writeSummarySection(worksheet, row, "Inventory Statistics", [
    ["Total Equipment Records", stats.total],
    ["Inventory View Records", stats.inventory],
    ["Archived Records", stats.archived],
    ["Active", stats.active],
    ["In Repair", stats.repair],
    ["Scrapped", stats.scrapped],
    ["Missing", stats.missing],
  ]);
  row += 1;
  row = writeSummarySection(worksheet, row, "Calibration", [
    ["Calibrated", stats.calibrated],
    ["Reference Only (No Cal)", stats.referenceOnly],
  ]);
  row += 1;
  writeSummarySection(worksheet, row, "Audit", [["Verified", stats.verified]]);
}

function writeSummarySection(worksheet, startRow, title, rows) {
  worksheet.mergeCells(startRow, 1, startRow, 2);
  const headerCell = worksheet.getCell(startRow, 1);
  headerCell.value = title;
  headerCell.font = { bold: true, size: 12, color: { argb: "1F2937" } };
  headerCell.fill = { fgColor: { argb: SECTION_BG }, pattern: "solid", type: "pattern" };
  headerCell.alignment = { vertical: "middle" };

  let currentRow = startRow + 1;

  for (const [label, value] of rows) {
    const labelCell = worksheet.getCell(currentRow, 1);
    const valueCell = worksheet.getCell(currentRow, 2);

    labelCell.value = label;
    labelCell.font = { size: 11, color: { argb: "374151" } };
    labelCell.alignment = { indent: 1, vertical: "middle" };
    valueCell.value = value;
    valueCell.font = { bold: true, size: 11, color: { argb: "1F2937" } };

    labelCell.border = { bottom: { style: "hair", color: { argb: BORDER_COLOR } } };
    valueCell.border = { bottom: { style: "hair", color: { argb: BORDER_COLOR } } };

    currentRow += 1;
  }

  return currentRow;
}

function buildSummaryStats(rows) {
  return {
    total: rows.length,
    inventory: rows.filter((row) => !Boolean(row.is_archived)).length,
    archived: rows.filter((row) => Boolean(row.is_archived)).length,
    active: countByValue(rows, "lifecycle_status", "active"),
    repair: countByValue(rows, "lifecycle_status", "repair"),
    scrapped: countByValue(rows, "lifecycle_status", "scrapped"),
    missing: countByValue(rows, "lifecycle_status", "missing"),
    calibrated: countByValue(rows, "calibration_status", "calibrated"),
    referenceOnly: countByValue(rows, "calibration_status", "reference_only"),
    verified: rows.filter((row) => Boolean(row.verified_in_survey)).length,
  };
}

function countByValue(rows, key, expectedValue) {
  return rows.filter((row) => String(row[key] ?? "").trim() === expectedValue).length;
}

function formatCellValue(rawValue, format) {
  if (format === "boolean") {
    return rawValue ? "Yes" : "";
  }
  if (format === "currency" || format === "number") {
    return rawValue == null ? null : Number(rawValue);
  }
  return rawValue == null ? "" : String(rawValue);
}

function getCellStyle(row, column, bandColor) {
  const baseFill = { fgColor: { argb: bandColor }, pattern: "solid", type: "pattern" };
  const baseFont = { color: { argb: "1F2937" }, size: 10 };

  if (column.format === "lifecycle") {
    return {
      alignment: { horizontal: "center", vertical: "middle" },
      fill: getLifecycleFill(row.lifecycle_status) ?? baseFill,
      font: getLifecycleFont(row.lifecycle_status) ?? baseFont,
    };
  }

  if (column.format === "working") {
    return {
      alignment: { horizontal: "center", vertical: "middle" },
      fill: getWorkingFill(row.working_status) ?? baseFill,
      font: getWorkingFont(row.working_status) ?? baseFont,
    };
  }

  if (column.format === "calibration") {
    return {
      alignment: { horizontal: "center", vertical: "middle" },
      fill: getCalibrationFill(row.calibration_status) ?? baseFill,
      font: getCalibrationFont(row.calibration_status) ?? baseFont,
    };
  }

  return {
    alignment: {
      horizontal: column.align,
      vertical: "middle",
      wrapText: Boolean(column.wrap),
    },
    fill: baseFill,
    font: rawTextIsBlank(row[column.key]) ? { color: { argb: "6B7280" }, size: 10 } : baseFont,
    numFmt: getNumberFormat(column.format, row[column.key]),
  };
}

function getNumberFormat(format, rawValue) {
  if (rawValue == null) {
    return undefined;
  }
  if (format === "currency") {
    return "$#,##0.00";
  }
  if (format === "number") {
    return "0.0";
  }
  return undefined;
}

function rawTextIsBlank(value) {
  return value == null || String(value).trim().length === 0;
}

function getLifecycleFill(value) {
  return {
    active: solidFill("DCFCE7"),
    repair: solidFill("FEF3C7"),
    scrapped: solidFill("FEE2E2"),
    missing: solidFill("FCE7F3"),
    rental: solidFill("DBEAFE"),
  }[String(value ?? "")];
}

function getLifecycleFont(value) {
  return {
    active: coloredFont("166534"),
    repair: coloredFont("92400E"),
    scrapped: coloredFont("991B1B"),
    missing: coloredFont("9D174D"),
    rental: coloredFont("1E40AF"),
  }[String(value ?? "")];
}

function getWorkingFill(value) {
  return {
    working: solidFill("DCFCE7"),
    limited: solidFill("FEF3C7"),
    not_working: solidFill("FEE2E2"),
  }[String(value ?? "")];
}

function getWorkingFont(value) {
  return {
    working: coloredFont("166534"),
    limited: coloredFont("92400E"),
    not_working: coloredFont("991B1B"),
  }[String(value ?? "")];
}

function getCalibrationFill(value) {
  return {
    calibrated: solidFill("DCFCE7"),
    out_to_cal: solidFill("FEF3C7"),
    reference_only: solidFill("EFF6FF"),
  }[String(value ?? "")];
}

function getCalibrationFont(value) {
  return {
    calibrated: coloredFont("166534"),
    out_to_cal: coloredFont("92400E"),
    reference_only: coloredFont("1E40AF"),
  }[String(value ?? "")];
}

function solidFill(argb) {
  return { fgColor: { argb }, pattern: "solid", type: "pattern" };
}

function coloredFont(argb) {
  return { color: { argb }, size: 10 };
}
