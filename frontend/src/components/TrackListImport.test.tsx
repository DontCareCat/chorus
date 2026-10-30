// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { TrackListImport } from "./TrackListImport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../services/api", async (orig) => {
  const real = await orig<typeof import("../services/api")>();
  return {
    ...real,
    api: {
      matchTracks: vi.fn(async (tracks: { title: string }[]) => ({ matches: tracks.flatMap((t, i) => (t.title === "Du hast" || t.title === "99 Luftballons" ? [{ index: i, song_id: i === 0 ? 5 : 9, song_title: t.title }] : [])) })),
      createPlaylist: vi.fn(async (name: string) => ({ id: 3, name })),
      addToPlaylist: vi.fn(async () => ({})),
      deletePlaylist: vi.fn(async () => ({})),
    },
  };
});

let host: HTMLElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const type = async (value: string) => {
  const ta = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, value); ta.dispatchEvent(new Event("input", { bubbles: true })); });
};
const click = async (text: string) => { await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click(); }); await flush(); };

describe("TrackListImport", () => {
  it("checks a pasted list, makes a playlist of the songs that are in the library and lists the rest with a YouTube search", async () => {
    await act(async () => root.render(<TrackListImport spotify onMade={() => undefined} />));
    expect(host.textContent).toContain("Spotify no longer lets other apps");
    await type("Rammstein - Du hast\nRammstein - Sonne\nNena - 99 Luftballons");
    await click("Check the list");
    expect(host.textContent).toContain("3 songs, 2 already in your library");
    expect(host.textContent).toContain("1 not in your library");
    const link = host.querySelector(".sp-missing a") as HTMLAnchorElement;
    expect(link.href).toContain("youtube.com/results?search_query=Rammstein%20Sonne");
    await click("Make a playlist of the 2 songs");
    const { api } = await import("../services/api");
    expect(api.createPlaylist).toHaveBeenCalledWith("Imported playlist");
    expect(api.addToPlaylist).toHaveBeenCalledWith(3, [5, 9]);
    expect(host.textContent).toContain("Playlist “Imported playlist” made with 2 songs");
  });
  it("says so when there is nothing to read", async () => {
    await act(async () => root.render(<TrackListImport spotify={false} onMade={() => undefined} />));
    await type("   \n  ");
    expect((host.querySelector("button.inverse") as HTMLButtonElement).disabled).toBe(true);
  });
});
