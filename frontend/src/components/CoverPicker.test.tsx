// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverPicker } from "./CoverPicker";
import { api, ApiError } from "../services/api";
import type { SongDto } from "../services/api";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

const song = (over: Partial<SongDto> = {}): SongDto => ({
  id: 7, title: "Du hast", artist: "Rammstein", album: null, duration: 100, language: "de", language_source: "default", lyrics_offset: 0, source: "upload", file_name: "x.wav",
  available: true, has_cover: false, cover_source: null, lyrics_status: "found", ...over,
});
const candidates = [
  { id: "m1", title: "Sehnsucht", artist: "Rammstein", date: "1997-08-22", score: 100 },
  { id: "m2", title: "Live aus Berlin", artist: "Rammstein", date: null, score: 98 },
];

describe("CoverPicker", () => {
  it("says where the cover comes from", () => {
    const { rerender } = render(<CoverPicker song={song()} onChanged={vi.fn()} />);
    expect(screen.getByText("This song has no cover.")).toBeTruthy();
    rerender(<CoverPicker song={song({ has_cover: true, cover_source: "embedded" })} onChanged={vi.fn()} />);
    expect(screen.getByText("The cover comes from the audio file.")).toBeTruthy();
    expect(screen.queryByText("Remove cover")).toBeNull(); // art in the audio file is never touched
    rerender(<CoverPicker song={song({ has_cover: true, cover_source: "online" })} onChanged={vi.fn()} />);
    expect(screen.getByText("Remove cover")).toBeTruthy();
    rerender(<CoverPicker song={song({ cover_source: "none" })} onChanged={vi.fn()} />);
    expect(screen.getByText("No cover was found online.")).toBeTruthy();
  });

  it("an automatic search that is not sure lists candidates, and choosing one saves it", async () => {
    vi.spyOn(api, "coverAuto").mockResolvedValue({ status: "choose" });
    vi.spyOn(api, "coverCandidates").mockResolvedValue(candidates);
    const choose = vi.spyOn(api, "coverChoose").mockResolvedValue(song({ has_cover: true, cover_source: "online" }));
    const onChanged = vi.fn();
    render(<CoverPicker song={song()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Search online" }));
    await waitFor(() => expect(screen.getByText("Sehnsucht")).toBeTruthy());
    expect(screen.getByText("Live aus Berlin")).toBeTruthy();
    expect(document.querySelectorAll(".cover-grid img")).toHaveLength(2);
    expect((document.querySelector(".cover-grid img") as HTMLImageElement).src).toContain("/api/songs/7/cover/candidates/m1/image"); // through our server
    fireEvent.click(screen.getAllByRole("button", { name: "Use this cover" })[1]!);
    await waitFor(() => expect(choose).toHaveBeenCalledWith(7, "m2"));
    await waitFor(() => expect(screen.getByText("Cover saved")).toBeTruthy());
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText("Sehnsucht")).toBeNull(); // the list closes
  });

  it("a confident automatic search just saves the cover", async () => {
    vi.spyOn(api, "coverAuto").mockResolvedValue({ status: "online" });
    const list = vi.spyOn(api, "coverCandidates");
    render(<CoverPicker song={song()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search online" }));
    await waitFor(() => expect(screen.getByText("Cover saved")).toBeTruthy());
    expect(list).not.toHaveBeenCalled();
  });

  it("a typed search uses the typed words; nothing found says what to do next", async () => {
    const list = vi.spyOn(api, "coverCandidates").mockResolvedValue([]);
    render(<CoverPicker song={song()} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Album or title"), { target: { value: "Mutter" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(list).toHaveBeenCalledWith(7, "Mutter"));
    await waitFor(() => expect(screen.getByText(/No covers found/)).toBeTruthy());
  });

  it("an unavailable cover service is explained in plain words", async () => {
    vi.spyOn(api, "coverAuto").mockRejectedValue(new ApiError("covers_unavailable", "The cover service is unavailable: HTTP 503", 502));
    render(<CoverPicker song={song()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search online" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("The cover service is unavailable. Try again in a moment."));
  });

  it("tells the person the artist and album are sent to MusicBrainz", () => {
    render(<CoverPicker song={song()} onChanged={vi.fn()} />);
    expect(screen.getByText(/sends the artist and album to MusicBrainz/)).toBeTruthy();
  });
});
