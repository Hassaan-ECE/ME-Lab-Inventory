import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InventoryShell } from "@/components/inventory/InventoryShell";

describe("InventoryShell entry actions", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete window.inventoryDesktop;
    vi.restoreAllMocks();
    mockMatchMedia(false);
  });

  it("adds a new entry from the toolbar dialog", async () => {
    const user = userEvent.setup();
    render(<InventoryShell />);

    await user.click(screen.getByRole("button", { name: "Add Entry" }));
    await user.type(screen.getByLabelText("Manufacturer / Brand"), "Acme Tooling");
    await user.type(screen.getByLabelText("Description"), "Laser-cut fixture plate");
    await user.type(screen.getByLabelText("Location"), "Shelf Z9");

    await user.click(screen.getByRole("button", { name: "Save Entry" }));

    expect(await screen.findByText("Laser-cut fixture plate")).toBeInTheDocument();
    expect(screen.getByText("Entry added locally.")).toBeInTheDocument();
    expect(screen.getByText("Showing all 11 entries")).toBeInTheDocument();
  });

  it("opens the editor on row double click and updates the entry", async () => {
    const user = userEvent.setup();
    render(<InventoryShell />);

    await user.dblClick(screen.getByText("Stainless socket-head cap screws, 1/4-20"));

    const locationInput = screen.getByLabelText("Location");
    await user.clear(locationInput);
    await user.type(locationInput, "Shelf Z9");
    await user.click(screen.getByRole("button", { name: "Save Entry" }));

    expect(await screen.findByText("Shelf Z9")).toBeInTheDocument();
    expect(screen.getByText("Entry updated locally.")).toBeInTheDocument();
  });

  it("keeps the edit actions in the sidebar on large viewports", async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);
    render(<InventoryShell />);

    await user.dblClick(screen.getByText("Stainless socket-head cap screws, 1/4-20"));

    expect(screen.getByText("Database Metadata")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save Entry" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);

    const locationInput = screen.getByLabelText("Location");
    await user.clear(locationInput);
    await user.type(locationInput, "Shelf Y4");
    await user.click(screen.getByRole("button", { name: "Save Entry" }));

    expect(await screen.findByText("Shelf Y4")).toBeInTheDocument();
  });

  it("archives an entry from the right-click menu", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<InventoryShell />);

    fireEvent.contextMenu(screen.getByText("Industrial multimeter"));
    expect(screen.queryByText("Entry Actions")).not.toBeInTheDocument();
    expect(screen.getAllByText("Industrial multimeter")).toHaveLength(1);
    await user.click(await screen.findByRole("button", { name: "Archive Entry" }));

    expect(screen.queryByText("Industrial multimeter")).not.toBeInTheDocument();
    expect(screen.getByText("Entry moved to the archive.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Archive/i })[0]);
    expect(await screen.findByText("Industrial multimeter")).toBeInTheDocument();
  });

  it("hides the saved-link action when a row has no link", () => {
    render(<InventoryShell />);

    fireEvent.contextMenu(screen.getByText("Long handle ratchet"));

    expect(screen.queryByRole("button", { name: "Open Saved Link" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search Online" })).toBeInTheDocument();
  });

  it("shows the saved-link action when a row has a link", () => {
    render(<InventoryShell />);

    fireEvent.contextMenu(screen.getByText("Industrial multimeter"));

    expect(screen.getByRole("button", { name: "Open Saved Link" })).toBeInTheDocument();
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
