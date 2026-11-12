// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast, useToast } from "./Toast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Harness({ okMs }: { okMs?: number }) {
  const [toast, setToast] = useToast(okMs);
  return (
    <>
      <button onClick={() => setToast({ kind: "ok", text: "Done" })}>ok</button>
      <button onClick={() => setToast({ kind: "progress", text: "Working" })}>progress</button>
      <button onClick={() => setToast({ kind: "error", text: "Broke" })}>error</button>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

describe("Toast", () => {
  it("a success leaves after its time and is unmounted after the fade", () => {
    vi.useFakeTimers();
    render(<Harness okMs={2500} />);
    fireEvent.click(screen.getByText("ok"));
    expect(screen.getByRole("status").textContent).toContain("Done");
    act(() => { vi.advanceTimersByTime(60); });
    expect(screen.getByRole("status").getAttribute("data-state")).toBe("open");
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.getByRole("status").getAttribute("data-state")).toBe("closed");
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("progress stays while it runs", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByText("progress"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByRole("status").textContent).toContain("Working");
  });
  it("an error stays until the × is pressed", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByText("error"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByRole("alert").textContent).toContain("Broke");
    fireEvent.click(screen.getByLabelText("Dismiss"));
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
