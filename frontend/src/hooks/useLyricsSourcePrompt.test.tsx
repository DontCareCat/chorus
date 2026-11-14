// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/lyrics-source", () => ({ loadService: vi.fn(), checkService: vi.fn(), saveService: vi.fn() }));
import { loadService } from "../lib/lyrics-source";
import { SKIP_KEY } from "../components/LyricsSourceWindow";
import { useLyricsSourcePrompt } from "./useLyricsSourcePrompt";

const load = loadService as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { sessionStorage.clear(); load.mockReset(); });

describe("useLyricsSourcePrompt", () => {
  it("asks the administrator while no lyrics service is set", async () => {
    load.mockResolvedValue("");
    const { result } = renderHook(() => useLyricsSourcePrompt(true));
    await waitFor(() => expect(result.current[0]).toBe(true));
  });
  it("does not ask when a lyrics service is already set", async () => {
    load.mockResolvedValue("https://lrclib.net/api");
    const { result } = renderHook(() => useLyricsSourcePrompt(true));
    await waitFor(() => expect(load).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current[0]).toBe(false);
  });
  it("does not ask anyone but the administrator, and does not even look", () => {
    const { result } = renderHook(() => useLyricsSourcePrompt(false));
    expect(result.current[0]).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
  it("does not ask again after Skip this time in the same run", () => {
    sessionStorage.setItem(SKIP_KEY, "1");
    const { result } = renderHook(() => useLyricsSourcePrompt(true));
    expect(result.current[0]).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
  it("does not ask when the lookup fails", async () => {
    load.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLyricsSourcePrompt(true));
    await waitFor(() => expect(load).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current[0]).toBe(false);
  });
});
