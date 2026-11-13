// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api", () => ({ api: { settings: vi.fn(), saveSettings: vi.fn(), checkLyricsService: vi.fn() } }));
import { api } from "../services/api";
import { LyricsSourceWindow, SKIP_KEY } from "./LyricsSourceWindow";

const mocked = api as unknown as { settings: ReturnType<typeof vi.fn>; saveSettings: ReturnType<typeof vi.fn>; checkLyricsService: ReturnType<typeof vi.fn> };

beforeEach(() => {
  sessionStorage.clear();
  mocked.settings.mockResolvedValue({ lyrics_service_url: "", other: 1 });
  mocked.saveSettings.mockImplementation(async (s: unknown) => s);
  mocked.checkLyricsService.mockResolvedValue({ ok: true, message: "" });
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
    expect(mocked.checkLyricsService).toHaveBeenCalledWith("https://lrclib.net");
    expect(mocked.saveSettings).toHaveBeenCalledWith({ lyrics_service_url: "https://lrclib.net", other: 1 });
  });
  it("saves the typed address", async () => {
    const done = vi.fn();
    render(<LyricsSourceWindow onDone={done} />);
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: " my.server.test " } });
    fireEvent.click(screen.getByText("Use specified"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocked.saveSettings).toHaveBeenCalledWith({ lyrics_service_url: "my.server.test", other: 1 });
  });
  it("a failed check shows the result under the field with Use anyway, which saves without a check; typing clears it", async () => {
    mocked.checkLyricsService.mockResolvedValue({ ok: false, message: "no" });
    const done = vi.fn();
    render(<LyricsSourceWindow onDone={done} />);
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: "bad.test" } });
    fireEvent.click(screen.getByText("Use specified"));
    await screen.findByText(/didn’t answer like an LRCLIB service/);
    expect(mocked.saveSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: "bad2.test" } });
    expect(screen.queryByText(/didn’t answer/)).toBeNull();
    fireEvent.click(screen.getByText("Use specified"));
    await screen.findByText("Use anyway");
    fireEvent.click(screen.getByText("Use anyway"));
    await waitFor(() => expect(done).toHaveBeenCalledWith("Lyrics service saved"));
    expect(mocked.saveSettings).toHaveBeenCalledWith({ lyrics_service_url: "bad2.test", other: 1 });
    expect(mocked.checkLyricsService).toHaveBeenCalledTimes(2);
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
