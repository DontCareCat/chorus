// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);
const options = [{ value: "de", label: "German (de)" }, { value: "en", label: "English (en)" }, { value: "fr", label: "French (fr)" }];

describe("Select", () => {
  it("shows the chosen label and opens a listbox with the chosen item ticked", () => {
    render(<Select value="en" onChange={() => undefined} options={options} ariaLabel="Language" />);
    expect(screen.getByRole("combobox").textContent).toBe("English (en)");
    fireEvent.click(screen.getByRole("combobox"));
    const items = screen.getAllByRole("option");
    expect(items.map((i) => i.textContent)).toEqual(["German (de)", "English (en)", "French (fr)"]);
    expect(items[1]!.getAttribute("aria-selected")).toBe("true");
    expect(items[1]!.querySelector("svg")).not.toBeNull();
  });
  it("picks with a click and closes", () => {
    const change = vi.fn();
    render(<Select value="en" onChange={change} options={options} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "French (fr)" }));
    expect(change).toHaveBeenCalledWith("fr");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("is operated with the keyboard: arrows, Enter, type-ahead and Esc", () => {
    const change = vi.fn();
    render(<Select value="de" onChange={change} options={options} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(change).toHaveBeenLastCalledWith("en");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: "f" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(change).toHaveBeenLastCalledWith("fr");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("shows the placeholder while nothing matches and closes on a tap outside", () => {
    render(<Select value="" placeholder="Places" onChange={() => undefined} options={options} />);
    expect(screen.getByRole("combobox").textContent).toBe("Places");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
