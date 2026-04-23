import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InventoryPrototype } from "@/components/inventory/InventoryPrototype";

describe("InventoryPrototype table controls", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders compact labels for long links", () => {
    render(<InventoryPrototype />);

    expect(screen.getByText("www.cejn.com/en-us/products/thermal-control")).toBeInTheDocument();
  });

  it("hides a selected column from the table", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getByRole("button", { name: /Columns/i }));
    await user.click(screen.getByRole("checkbox", { name: "Links" }));

    expect(screen.queryByRole("columnheader", { name: /Links/i })).not.toBeInTheDocument();
  });

  it("disables the last visible data column in the menu", async () => {
    const user = userEvent.setup();
    render(<InventoryPrototype />);

    await user.click(screen.getByRole("button", { name: /Columns/i }));
    await user.click(screen.getByRole("checkbox", { name: "Links" }));
    await user.click(screen.getByRole("checkbox", { name: "Location" }));
    await user.click(screen.getByRole("checkbox", { name: "Description" }));
    await user.click(screen.getByRole("checkbox", { name: "Model" }));
    await user.click(screen.getByRole("checkbox", { name: "Manufacturer" }));

    expect(screen.getByRole("checkbox", { name: "Qty" })).toBeDisabled();
    expect(screen.getByRole("columnheader", { name: /Qty/i })).toBeInTheDocument();
  });
});
