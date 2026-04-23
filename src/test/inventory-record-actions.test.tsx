import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InventoryPrototype } from "@/components/inventory/InventoryPrototype";

describe("InventoryPrototype record actions", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete window.inventoryDesktop;
    vi.restoreAllMocks();
  });

  it("adds a new record from the toolbar dialog", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getByRole("button", { name: "Add Record" }));
    await user.type(screen.getByLabelText("Manufacturer / Brand"), "Acme Tooling");
    await user.type(screen.getByLabelText("Description"), "Laser-cut fixture plate");
    await user.type(screen.getByLabelText("Location"), "Shelf Z9");

    await user.click(screen.getByRole("button", { name: "Save Record" }));

    expect(await screen.findByText("Laser-cut fixture plate")).toBeInTheDocument();
    expect(screen.getByText("Record added locally in the prototype.")).toBeInTheDocument();
    expect(screen.getByText("Showing all 11 equipment records")).toBeInTheDocument();
  });

  it("opens the editor on row double click and updates the record", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.dblClick(screen.getByText("Stainless socket-head cap screws, 1/4-20"));

    const locationInput = screen.getByLabelText("Location");
    await user.clear(locationInput);
    await user.type(locationInput, "Shelf Z9");
    await user.click(screen.getByRole("button", { name: "Save Record" }));

    expect(await screen.findByText("Shelf Z9")).toBeInTheDocument();
    expect(screen.getByText("Record updated locally in the prototype.")).toBeInTheDocument();
  });

  it("archives a record from the right-click menu", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<InventoryPrototype />);

    fireEvent.contextMenu(screen.getByText("Industrial multimeter"));
    await user.click(await screen.findByRole("button", { name: "Archive Record" }));

    expect(screen.queryByText("Industrial multimeter")).not.toBeInTheDocument();
    expect(screen.getByText("Record moved to the archive.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Archive/i })[0]);
    expect(await screen.findByText("Industrial multimeter")).toBeInTheDocument();
  });
});
