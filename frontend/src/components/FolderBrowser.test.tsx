// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crumbs, FolderBrowser } from "./FolderBrowser";
import { api, ApiError } from "../services/api";
import type { FsListingDto } from "../services/api";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

const roots = [{ name: "Home", path: "/home/me" }, { name: "Music", path: "/home/me/Music" }];
const listing = (path: string, entries: FsListingDto["entries"], parent: string | null = "/home/me"): FsListingDto => ({ path, parent, entries, roots });
const MUSIC = listing("/home/me/Music", [
  { name: "Albums", kind: "dir", size: null, link: false },
  { name: "a.mp3", kind: "audio", size: 3_400_000, link: false },
  { name: "b.flac", kind: "audio", size: 20_000, link: false },
]);

describe("crumbs", () => {
  it("splits unix and windows paths", () => {
    expect(crumbs("/home/me/Music")).toEqual([{ label: "/", path: "/" }, { label: "home", path: "/home" }, { label: "me", path: "/home/me" }, { label: "Music", path: "/home/me/Music" }]);
    expect(crumbs("C:\\Music\\Rock")).toEqual([{ label: "C:", path: "C:\\" }, { label: "Music", path: "C:\\Music" }, { label: "Rock", path: "C:\\Music\\Rock" }]);
  });
});

describe("FolderBrowser", () => {
  it("lists folders and songs, walks into a folder, goes up, and jumps to a typed path", async () => {
    const list = vi.spyOn(api, "listFolder").mockImplementation(async (p) =>
      p === "/home/me/Music/Albums" ? listing(p, [{ name: "c.ogg", kind: "audio", size: 1000, link: false }], "/home/me/Music") : MUSIC);
    render(<FolderBrowser mode="import" start="/home/me/Music" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("a.mp3")).toBeTruthy());
    expect(screen.getByText("3.4 MB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Albums" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("/home/me/Music/Albums", false));
    await waitFor(() => expect(screen.getByText("c.ogg")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Up one folder" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("/home/me/Music", false));
    await screen.findByText("a.mp3"); // the listing has arrived (it also resets the path box)
    const field = screen.getByLabelText("Folder") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "/mnt/disk" } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("/mnt/disk", false));
  });

  it("a listing that arrives while the person is typing does not overwrite the path box", async () => {
    let finish: (l: FsListingDto) => void = () => {};
    vi.spyOn(api, "listFolder").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<FolderBrowser mode="import" onClose={vi.fn()} />);
    const field = screen.getByLabelText("Folder") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "/mnt/typed" } });
    finish(MUSIC);
    await screen.findByText("a.mp3");
    expect(field.value).toBe("/mnt/typed");
  });

  it("selects several songs and a folder and imports them in one request, with the options and filters", async () => {
    vi.spyOn(api, "listFolder").mockResolvedValue(MUSIC);
    const imp = vi.spyOn(api, "importMany").mockResolvedValue({ added: 3, skipped: 0, unavailable: 0, filtered: 1, errors: [] });
    const onImported = vi.fn();
    const onClose = vi.fn();
    render(<FolderBrowser mode="import" start="/home/me/Music" onImported={onImported} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("a.mp3")).toBeTruthy());
    const importBtn = screen.getByRole("button", { name: "Import selected" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select a.mp3"));
    fireEvent.click(screen.getByLabelText("Select Albums"));
    expect(screen.getByText("1 song and 1 folder selected")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Include subfolders")); // turn it off
    fireEvent.click(screen.getByLabelText("Copy files into the app's storage"));
    fireEvent.change(screen.getByLabelText("Only names that match"), { target: { value: "\\.mp3$" } });
    fireEvent.click(importBtn);
    await waitFor(() => expect(imp).toHaveBeenCalledTimes(1));
    expect(imp.mock.calls[0]![0]).toEqual({
      paths: ["/home/me/Music/a.mp3", "/home/me/Music/Albums"], recursive: false, copyFiles: true, include: "\\.mp3$", exclude: "",
    });
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ added: 3, skipped: 0, unavailable: 0, filtered: 1, errors: [] }));
    expect(onClose).toHaveBeenCalled();
  });

  it("select all / none work on what is listed", async () => {
    vi.spyOn(api, "listFolder").mockResolvedValue(MUSIC);
    render(<FolderBrowser mode="import" start="/home/me/Music" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("a.mp3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2 songs and 1 folder selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(screen.getByText("Nothing selected")).toBeTruthy();
  });

  it("shows a server error (a bad filter) and stays open", async () => {
    vi.spyOn(api, "listFolder").mockResolvedValue(MUSIC);
    vi.spyOn(api, "importMany").mockRejectedValue(new ApiError("invalid_pattern", "The include pattern is not a valid regular expression: missing )", 422));
    const onClose = vi.fn();
    render(<FolderBrowser mode="import" start="/home/me/Music" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("a.mp3")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Select a.mp3"));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not a valid regular expression/));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Import selected" }) as HTMLButtonElement).disabled).toBe(false); // can be corrected and retried
  });

  it("explains when browsing is not allowed for this person", async () => {
    vi.spyOn(api, "listFolder").mockRejectedValue(new ApiError("path_access_denied", "no", 403));
    render(<FolderBrowser mode="import" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/only allowed from the computer running Chorus/));
  });

  it("folder mode picks one folder and has no selection boxes or filters", async () => {
    vi.spyOn(api, "listFolder").mockResolvedValue(MUSIC);
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<FolderBrowser mode="folder" start="/home/me/Music" onPickFolder={onPick} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("Albums")).toBeTruthy());
    expect(screen.getAllByRole("checkbox")).toHaveLength(1); // only "Show hidden items": no song checkboxes
    expect(screen.queryByLabelText("Select Albums")).toBeNull();
    expect(screen.queryByText("Only some files (regular expressions)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(onPick).toHaveBeenCalledWith("/home/me/Music");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes with Escape and has dialog semantics", async () => {
    vi.spyOn(api, "listFolder").mockResolvedValue(MUSIC);
    const onClose = vi.fn();
    render(<FolderBrowser mode="import" onClose={onClose} />);
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
