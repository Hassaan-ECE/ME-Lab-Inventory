import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InventoryPrototype } from "@/components/inventory/InventoryPrototype";
import type { InventoryRecord } from "@/types/inventory";

describe("InventoryPrototype shell", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete window.inventoryDesktop;
  });

  it("renders the inventory view by default with seeded counts", () => {
    render(<InventoryPrototype />);

    expect(screen.getAllByText("ME Lab Inventory")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Import Data" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export HTML" })).toBeInTheDocument();
    expect(screen.getByText("Showing all 10 equipment records")).toBeInTheDocument();
    expect(screen.getByText("Total: 14 | Verified: 8/14")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Manufacturer/i })).toBeInTheDocument();
  });

  it("loads records from the desktop bridge when available", async () => {
    const desktopRecords: InventoryRecord[] = [
      {
        id: "101",
        assetNumber: "ME-101",
        qty: 1,
        manufacturer: "Bridgeport",
        model: "Series I",
        description: "Vertical milling machine",
        projectName: "Fixture rework",
        location: "ME Bay",
        links: "",
        notes: "",
        lifecycleStatus: "active",
        workingStatus: "working",
        verifiedInSurvey: true,
        archived: false,
        updatedAt: "2026-04-23 10:00:00",
      },
      {
        id: "102",
        assetNumber: "ME-102",
        qty: 2,
        manufacturer: "Mitutoyo",
        model: "500-196-30",
        description: "Digital caliper",
        projectName: "Incoming inspection",
        location: "Tool crib",
        links: "",
        notes: "",
        lifecycleStatus: "active",
        workingStatus: "working",
        verifiedInSurvey: false,
        archived: false,
        updatedAt: "2026-04-22 09:00:00",
      },
    ];

    window.inventoryDesktop = {
      isDesktop: true,
      loadInventory: vi.fn().mockResolvedValue({
        dbPath: "D:/coding/IMS_t3code_ref_design/data/me_lab_inventory.db",
        records: desktopRecords,
      }),
      toggleVerified: vi.fn().mockResolvedValue(desktopRecords[0]),
      createRecord: vi.fn().mockResolvedValue(desktopRecords[0]),
      updateRecord: vi.fn().mockResolvedValue(desktopRecords[0]),
      setArchived: vi.fn().mockResolvedValue(desktopRecords[0]),
      deleteRecord: vi.fn().mockResolvedValue({ recordId: desktopRecords[0].id }),
      openExternal: vi.fn().mockResolvedValue(true),
      exportExcel: vi.fn().mockResolvedValue({ canceled: false, outputPath: "D:/exports/ME_Lab_Inventory_Export.xlsx" }),
    };

    render(<InventoryPrototype />);

    expect(screen.getByText("Loading inventory records...")).toBeInTheDocument();
    expect(await screen.findByText("Showing all 2 equipment records")).toBeInTheDocument();
    expect(screen.getByText("Bridgeport")).toBeInTheDocument();
    expect(screen.getByText("Total: 2 | Verified: 1/2")).toBeInTheDocument();
  });

  it("switches to archive view and updates the summary", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getAllByRole("button", { name: /Archive/i })[0]);

    expect(screen.getByText("Showing all 4 archived records")).toBeInTheDocument();
    expect(screen.getByText("Cabinet table saw")).toBeInTheDocument();
  });

  it("shows and clears the filter panel", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getByRole("button", { name: "Filters" }));
    const manufacturerFilter = screen.getByLabelText("Filter manufacturer");
    await user.type(manufacturerFilter, "Mitutoyo");

    expect(screen.getByText("Showing 1 filtered equipment records")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear Column Filters" }));
    expect(screen.getByText("Showing all 10 equipment records")).toBeInTheDocument();
  });

  it("shows the inventory empty-state CTA for unmatched searches", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.type(screen.getByLabelText("Inventory search"), "no-match-value");

    expect(screen.getByText('No results for "no-match-value"')).toBeInTheDocument();
    expect(
      screen.getByText("Try a broader search, clear the column filters, or add a new record."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add Record" }).length).toBeGreaterThan(0);
  });

  it("updates theme preference and shows mock verified feedback", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getAllByRole("button", { name: /Dark/i })[0]);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ims.t3.theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: /Toggle verified for Stainless socket-head cap screws/i }));
    expect(screen.getByText("Verified state updated locally in the prototype.")).toBeInTheDocument();
  });

  it("shows the HTML export placeholder message", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getByRole("button", { name: "Export HTML" }));

    expect(screen.getByText("HTML export is not implemented yet.")).toBeInTheDocument();
  });

  it("runs desktop Excel export when available", async () => {
    const user = userEvent.setup();
    const exportExcel = vi.fn().mockResolvedValue({
      canceled: false,
      outputPath: "D:/exports/ME_Lab_Inventory_Export.xlsx",
    });

    window.inventoryDesktop = {
      isDesktop: true,
      loadInventory: vi.fn().mockResolvedValue({
        dbPath: "D:/coding/IMS_t3code_ref_design/data/me_lab_inventory.db",
        records: [],
      }),
      toggleVerified: vi.fn().mockResolvedValue(null),
      createRecord: vi.fn().mockResolvedValue(null),
      updateRecord: vi.fn().mockResolvedValue(null),
      setArchived: vi.fn().mockResolvedValue(null),
      deleteRecord: vi.fn().mockResolvedValue({ recordId: "0" }),
      openExternal: vi.fn().mockResolvedValue(true),
      exportExcel,
    };

    render(<InventoryPrototype />);

    await user.click(screen.getByRole("button", { name: "Export Excel" }));

    expect(exportExcel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Excel export completed.")).toBeInTheDocument();
  });
});
