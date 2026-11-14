// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/lyrics-source", () => ({ checkService: vi.fn(), saveService: vi.fn(), loadService: vi.fn() }));
import { checkService, saveService } from "../lib/lyrics-source";
import { LyricsSourceWindow, SKIP_KEY } from "./LyricsSourceWindow";

const mocked = { saveService: saveService as unknown as ReturnType<typeof vi.fn>, checkService: checkService as unknown as ReturnType<typeof vi.fn> };

beforeEach(() => {
  sessionStorage.clear();
  mocked.saveService.mockResolvedValue(undefined);
  mocked.checkService.mockResolvedValue({ ok: true, message: "" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LyricsSourceWindow", () => {
  it("is a modal dialog with the field focused, empty, with lrclib.net only as a placeholder", () => {
    render(<LyricsSourceWindow onDone={() => undefined} />);
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    const input = screen.getByLabelText("Lyrics service") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("https://lrclib.net");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Use lrclib.net")).toBeTruthy();
  });
  it("the button reads Use specified once something is typed, and Use lrclib.net again when it is emptied", () => {
    render(<LyricsSourceWindow onDone={() => undefined} />);
    const input = screen.getByLabelText("Lyrics service");
    fireEvent.change(input, { target: { value: "x.test" } });
    expect(screen.getByText("Use specified")).toBeTruthy();
    fireEvent.change(input, { target: { value: "  " } });
    expect(screen.getByText("Use lrclib.net")).toBeTruthy();
  });
  it("checks, saves https://lrclib.net when the field is empty, and says so", async () => {
    const done = vi.fn();
    render(<LyricsSourceWindow onDone={done} />);
    fireEvent.click(screen.getByText("Use lrclib.net"));
    await waitFor(() => expect(done).toHaveBeenCalledWith("Lyrics service saved"));
    expect(mocked.checkService).toHaveBeenCalledWith("https://lrclib.net");
    expect(mocked.saveService).toHaveBeenCalledWith("https://lrclib.net");
  });
  it("saves the typed address", async () => {
    const done = vi.fn();
    render(<LyricsSourceWindow onDone={done} />);
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: " my.server.test " } });
    fireEvent.click(screen.getByText("Use specified"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocked.saveService).toHaveBeenCalledWith("my.server.test");
  });
  it("a failed check turns the main button into Use anyway (same button, no separate card), which saves without a check; typing resets it", async () => {
    mocked.checkService.mockResolvedValue({ ok: false, message: "no" });
    const done = vi.fn();
    const { container } = render(<LyricsSourceWindow onDone={done} />);
    const input = screen.getByLabelText("Lyrics service");
    fireEvent.change(input, { target: { value: "bad.test" } });
    const main = container.querySelector(".ls-big") as HTMLButtonElement;
    fireEvent.click(main);
    await screen.findByRole("alert");
    expect(main.textContent).toBe("Use anyway");
    expect((container.querySelector(".ls-big") as HTMLButtonElement)).toBe(main); // the same button
    expect(container.querySelectorAll("button.btn").length).toBe(0); // no second "Use anyway" pill
    expect(container.querySelector(".ls-result")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/didn\u2019t answer like an LRCLIB service/);
    expect(mocked.saveService).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "bad2.test" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(main.textContent).toBe("Use specified");
    fireEvent.click(main);
    await screen.findByRole("alert");
    fireEvent.click(main);
    await waitFor(() => expect(done).toHaveBeenCalledWith("Lyrics service saved"));
    expect(mocked.saveService).toHaveBeenCalledWith("bad2.test");
    expect(mocked.checkService).toHaveBeenCalledTimes(2); // Use anyway does not check again
  });
  it("the same for the default: Use lrclib.net becomes Use anyway when its check fails", async () => {
    mocked.checkService.mockResolvedValue({ ok: false, message: "no" });
    const { container } = render(<LyricsSourceWindow onDone={() => undefined} />);
    fireEvent.click(screen.getByText("Use lrclib.net"));
    await screen.findByRole("alert");
    expect((container.querySelector(".ls-big") as HTMLButtonElement).textContent).toBe("Use anyway");
  });
  it("Skip this time and Esc close it for this run; a click on the scrim does nothing", () => {
    const done = vi.fn();
    const { container } = render(<LyricsSourceWindow onDone={done} />);
    fireEvent.click(container.querySelector(".ls-scrim")!);
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Skip this time"));
    expect(done).toHaveBeenCalledWith("No lyrics service for now. Set one any time in Settings.");
    expect(sessionStorage.getItem(SKIP_KEY)).toBe("1");
    sessionStorage.clear();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(done).toHaveBeenCalledTimes(2);
  });
  it("has the low-contrast disclaimer", () => {
    render(<LyricsSourceWindow onDone={() => undefined} />);
    expect(screen.getByText(/doesn’t provide lyrics/)).toBeTruthy();
  });
});
