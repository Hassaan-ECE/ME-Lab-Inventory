import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecordDialog } from "@/components/inventory/RecordDialog";
import type { InventoryRecord, InventoryRecordInput } from "@/types/inventory";

const BASE_RECORD: InventoryRecord = {
  archived: false,
  assetNumber: "ME-401",
  description: "Precision fixture plate",
  id: "401",
  links: "",
  lifecycleStatus: "active",
  location: "Shelf B2",
  manufacturer: "Acme",
  model: "FP-401",
  notes: "",
  picturePath: "C:\\Pictures\\fixture-plate.jpg",
  projectName: "Fixture Lab",
  qty: 1,
  recordUuid: "uuid-401",
  serialNumber: "SER-401",
  updatedAt: "2026-04-23 09:00:00",
  verifiedInSurvey: true,
  workingStatus: "working",
};

describe("RecordDialog", () => {
  beforeEach(() => {
    delete window.inventoryDesktop;
    vi.restoreAllMocks();
    mockMatchMedia(false);
  });

  it("prepopulates the picture path and saves it with the record input", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined) as unknown as (_: InventoryRecordInput) => Promise<void>;

    render(
      <RecordDialog
        mode="edit"
        record={BASE_RECORD}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const picturePathInput = screen.getByLabelText("Picture Path");
    expect(picturePathInput).toHaveValue("C:\\Pictures\\fixture-plate.jpg");

    await user.clear(picturePathInput);
    await user.type(picturePathInput, "C:\\Pictures\\fixture-plate-updated.jpg");
    await user.click(screen.getByRole("button", { name: "Save Record" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        picturePath: "C:\\Pictures\\fixture-plate-updated.jpg",
      }),
    );
  });

  it("fills the picture path from the desktop picker", async () => {
    const user = userEvent.setup();
    const pickPicturePath = vi.fn().mockResolvedValue("C:\\Pictures\\selected-image.jpg");
    window.inventoryDesktop = createDesktopBridge({
      pickPicturePath,
    });

    render(
      <RecordDialog
        mode="add"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Browse" }));

    expect(pickPicturePath).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Picture Path")).toHaveValue("C:\\Pictures\\selected-image.jpg");
  });

  it("opens the picture in the desktop viewer from the large-screen preview", async () => {
    const openPath = vi.fn().mockResolvedValue(true);
    window.inventoryDesktop = createDesktopBridge({
      openPath,
    });
    mockMatchMedia(true);

    render(
      <RecordDialog
        mode="edit"
        record={BASE_RECORD}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.load(screen.getByAltText("Record picture preview"));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Picture preview" }));

    expect(openPath).toHaveBeenCalledWith("C:\\Pictures\\fixture-plate.jpg");
  });

  it("shows a missing-picture fallback when the preview fails to load", () => {
    render(
      <RecordDialog
        mode="edit"
        record={BASE_RECORD}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.error(screen.getByAltText("Record picture preview"));

    expect(screen.getAllByText("Picture not found").length).toBeGreaterThan(0);
  });

  it("uses the taller large-screen dialog sizing so the 1080p editor has more headroom", () => {
    mockMatchMedia(true);

    render(
      <RecordDialog
        mode="edit"
        record={BASE_RECORD}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const dialogPanel = screen.getByRole("dialog").firstElementChild;
    expect(dialogPanel).toHaveClass("max-h-[92vh]", "lg:max-h-[94vh]");
  });
});

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    writable: true,
  });
}

function createDesktopBridge(
  overrides: Partial<NonNullable<Window["inventoryDesktop"]>>,
): NonNullable<Window["inventoryDesktop"]> {
  return {
    isDesktop: true,
    loadInventory: vi.fn().mockResolvedValue({ dbPath: "", records: [] }),
    syncInventory: vi.fn().mockResolvedValue({
      dbPath: "",
      records: [],
      shared: {
        available: true,
        canModify: true,
        enabled: true,
        message: "",
      },
    }),
    toggleVerified: vi.fn().mockResolvedValue(BASE_RECORD),
    createRecord: vi.fn().mockResolvedValue(BASE_RECORD),
    updateRecord: vi.fn().mockResolvedValue(BASE_RECORD),
    setArchived: vi.fn().mockResolvedValue(BASE_RECORD),
    deleteRecord: vi.fn().mockResolvedValue({ recordId: BASE_RECORD.id }),
    openExternal: vi.fn().mockResolvedValue(true),
    openPath: vi.fn().mockResolvedValue(true),
    pickPicturePath: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as NonNullable<Window["inventoryDesktop"]>;
}
