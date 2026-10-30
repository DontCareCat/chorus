// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { SpotifyPlaylistImport } from "./SpotifyPlaylistImport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const list = {
  playlist_id: "x", name: "Mix", total: 3, matched: 2,
  tracks: [
    { spotify_id: "a", title: "Du hast", artist: "Rammstein", album: "", duration: 234, song_id: 5, song_title: "Du hast" },
    { spotify_id: "b", title: "Sonne", artist: "Rammstein", album: "", duration: 270, song_id: null, song_title: null },
    { spotify_id: "c", title: "99 Luftballons", artist: "Nena", album: "", duration: 233, song_id: 9, song_title: "99 Luftballons" },
  ],
};
let reply: () => Promise<unknown> = async () => list;
vi.mock("../services/api", async (orig) => {
  const real = await orig<typeof import("../services/api")>();
  return { ...real, api: { spotifyPlaylist: () => reply(), createPlaylist: vi.fn(async (name: string) => ({ id: 3, name })), addToPlaylist: vi.fn(async () => ({})), deletePlaylist: vi.fn(async () => ({})) } };
});

let host: HTMLElement;
let root: Root;
beforeEach(() => { reply = async () => list; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("SpotifyPlaylistImport", () => {
  it("makes a playlist of the tracks that are in the library and lists the rest with a YouTube search", async () => {
    await act(async () => root.render(<SpotifyPlaylistImport link="spotify:playlist:x" onMade={() => undefined} />));
    await flush();
    expect(host.textContent).toContain("3 tracks, 2 already in your library");
    expect(host.textContent).toContain("1 not in your library");
    const link = host.querySelector(".sp-missing a") as HTMLAnchorElement;
    expect(link.href).toContain("youtube.com/results?search_query=Rammstein%20Sonne");
    expect(link.rel).toContain("noreferrer");
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Make a playlist"))!.click(); });
    await flush();
    const { api } = await import("../services/api");
    expect(api.createPlaylist).toHaveBeenCalledWith("Mix");
    expect(api.addToPlaylist).toHaveBeenCalledWith(3, [5, 9]);
    expect(host.textContent).toContain("Playlist “Mix” made with 2 songs");
  });

  it("points to Settings when Spotify is not set up", async () => {
    const { ApiError } = await import("../services/api");
    reply = async () => { throw new ApiError("spotify_not_set_up", "Add your Spotify client id and secret in Settings first.", 422); };
    await act(async () => root.render(<SpotifyPlaylistImport link="spotify:playlist:x" onMade={() => undefined} />));
    await flush();
    expect(host.textContent).toContain("Add your Spotify client id");
    expect((host.querySelector("a") as HTMLAnchorElement).getAttribute("href")).toBe("#/settings");
  });
});
