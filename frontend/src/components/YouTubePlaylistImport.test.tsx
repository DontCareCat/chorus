// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { YouTubePlaylistImport } from "./YouTubePlaylistImport";
import { ApiError } from "../services/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ids = Array.from({ length: 45 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
const calls: string[][] = [];
let failAt = -1;
const song = (id: string) => ({ id: Number(id.slice(3)) + 1, lyrics_status: "pending" });

vi.mock("../services/audio/youtube-player", () => ({ loadPlaylistVideoIds: async () => ids }));
vi.mock("../services/api", async (orig) => {
  const real = await orig<typeof import("../services/api")>();
  return {
    ...real,
    api: {
      youtubePlaylistTitle: async () => ({ title: "tool" }),
      importYouTubeVideos: async (batch: string[]) => {
        calls.push(batch);
        if (failAt === calls.length) throw new real.ApiError("boom", "The server is busy", 500);
        return { songs: batch.map(song), added: batch.length, existing: 0, failed: [], not_tried: [] };
      },
      createPlaylist: vi.fn(async (name: string) => ({ id: 7, name })),
      addToPlaylist: vi.fn(async () => ({})),
      deletePlaylist: vi.fn(async () => ({})),
      retryLyrics: vi.fn(async () => ({ queued: 1 })),
    },
  };
});

let host: HTMLElement;
let root: Root;
beforeEach(() => { calls.length = 0; failAt = -1; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (text: string) => { await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click(); }); await flush(); await flush(); };

describe("YouTubePlaylistImport", () => {
  it("adds the videos in batches of 20, makes the playlist and asks for the lyrics once", async () => {
    const added = vi.fn();
    await act(async () => root.render(<YouTubePlaylistImport listId="PLx0000000000" onAdded={added} />));
    await flush();
    expect(host.textContent).toContain("45 videos");
    await click("Add 45 songs");
    expect(calls.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(host.textContent).toContain("45 added");
    expect(host.textContent).toContain("Playlist “tool” made");
    const { api } = await import("../services/api");
    expect(api.addToPlaylist).toHaveBeenCalledWith(7, expect.arrayContaining([1, 45]));
    expect(api.retryLyrics).toHaveBeenCalledTimes(1);
    expect(added).toHaveBeenCalled();
  });

  it("keeps what was added when a batch fails, and finishes the rest on retry", async () => {
    failAt = 2;
    await act(async () => root.render(<YouTubePlaylistImport listId="PLx0000000000" onAdded={() => undefined} />));
    await flush();
    await click("Add 45 songs");
    expect(host.textContent).toContain("20 added");
    expect(host.textContent).toContain("The server is busy");
    expect(host.textContent).toContain("25 are not added yet");
    await click("Add the rest");
    expect(host.textContent).toContain("45 added");
    expect(host.textContent).toContain("Playlist “tool” made");
  });

  it("names a playlist again when the name is taken", async () => {
    const { api } = await import("../services/api");
    (api.createPlaylist as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new ApiError("name_taken", "taken", 409); });
    await act(async () => root.render(<YouTubePlaylistImport listId="PLx0000000000" onAdded={() => undefined} />));
    await flush();
    await click("Add 45 songs");
    expect(host.textContent).toContain("Playlist “tool (2)” made");
  });
});
