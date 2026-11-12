// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDto, UserDto } from "../services/api";

const settings: SettingsDto = {
  lyrics_service_url: "https://lrclib.net/api", allow_unsynchronized_lyrics: false, lyrics_cache_ttl_days: 30, lyrics_timeout_minutes: 10, default_queue_difficulty: "progressive",
  queue_autoplay: true, queue_fade: false, queue_fade_seconds: 4, auto_fetch_lyrics: true, auto_fetch_covers: true, auto_detect_language: true, auto_pick_closest: false,
  default_language: "de", library_dirs: [], translation_enabled: true, youtube_enabled: true, allow_guest: true, allow_registration: true,
};
const me = (p: Partial<UserDto> = {}) => ({ id: 1, username: "anna", display_name: "Anna", is_admin: true, is_guest: false, translation_language: "en", daily_card_limit: 0, dictionary_mode: "auto", ...p }) as UserDto;
let user = me();

const api = vi.hoisted(() => ({
  settings: vi.fn(), saveSettings: vi.fn(), checkLyricsService: vi.fn(), health: vi.fn(), users: vi.fn(), retryLyrics: vi.fn(), clearCache: vi.fn(), updateAccount: vi.fn(), changePassword: vi.fn(),
}));
vi.mock("../services/api", async (orig) => ({ ...(await orig<typeof import("../services/api")>()), api }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user, state: { allow_registration: true }, refresh: vi.fn(), signOut: vi.fn() }) }));
vi.mock("../components/Confirm", () => ({ useConfirm: () => async () => true }));

import { SettingsPage, daysStep, minutesStep, stepValue } from "./SettingsPage";

beforeEach(() => {
  user = me();
  api.settings.mockResolvedValue({ ...settings });
  api.saveSettings.mockImplementation(async (s: SettingsDto) => s);
  api.health.mockResolvedValue({ status: "ok", app: "chorus", version: "0.2.0" });
  api.users.mockResolvedValue([me()]);
  api.checkLyricsService.mockResolvedValue({ ok: true, message: "The lyrics service answers." });
  Object.assign(api, {});
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
  window.scrollTo = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const open = async () => { render(<SettingsPage />); await screen.findByText("Lyrics service"); };

describe("SettingsPage", () => {
  it("lists the sections in order, with Lyrics right after Appearance and the lyrics service first in it", async () => {
    await open();
    const ids = [...document.querySelectorAll(".scard")].map((e) => e.getAttribute("data-section"));
    expect(ids).toEqual(["account", "appearance", "lyrics", "playing", "dictionary", "library", "server", "about"]);
    const first = document.querySelector("#settings-lyrics .srow")!;
    expect(first.textContent).toContain("Lyrics service");
    expect(first.textContent).toContain("Address of an LRCLIB-compatible server. Empty means lyrics files and uploads only.");
  });
  it("hides the Server section from people who are not administrators and makes the service address read-only", async () => {
    user = me({ is_admin: false });
    await open();
    expect(document.querySelector("#settings-server")).toBeNull();
    const input = screen.getByLabelText("Lyrics service") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText("Only the administrator can change this.")).not.toBeNull();
  });
  it("a switch applies at once, shows the floating Saved and sends the full settings", async () => {
    await open();
    fireEvent.click(screen.getByRole("switch", { name: "Pick the closest match by itself" }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    expect(api.saveSettings.mock.calls[0]![0]).toMatchObject({ auto_pick_closest: true, auto_fetch_lyrics: true, lyrics_service_url: "https://lrclib.net/api" });
    expect((await screen.findByText("Saved")).closest(".float-toast")).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Pick the closest match by itself" }).getAttribute("aria-checked")).toBe("true");
  });
  it("a stepper applies at once and stays inside 1 to 1440 minutes", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Warn when not found after: More" }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    expect(api.saveSettings.mock.calls[0]![0].lyrics_timeout_minutes).toBe(15);
    expect(stepValue(1, -1, minutesStep, 1, 1440)).toBe(1);
    expect(stepValue(1440, 1, minutesStep, 1, 1440)).toBe(1440);
    expect(stepValue(60, -1, minutesStep, 1, 1440)).toBe(55);
    expect(stepValue(30, 1, daysStep, 1, 3650)).toBe(37);
  });
  it("Keep forever stores 0 days and dims the stepper", async () => {
    await open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep forever" }));
    await waitFor(() => expect(api.saveSettings.mock.calls[0]![0].lyrics_cache_ttl_days).toBe(0));
    expect(document.querySelector("[data-kind=stepper][data-value='0'] .stepper[data-disabled]")).not.toBeNull();
  });
  it("the service address has its own Save, enabled only after an edit, and it checks the server first", async () => {
    await open();
    const save = () => screen.getAllByRole("button", { name: "Save" })[0] as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: "https://my.test/api" } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(api.checkLyricsService).toHaveBeenCalledWith("https://my.test/api"));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    expect(api.saveSettings.mock.calls[0]![0].lyrics_service_url).toBe("https://my.test/api");
    expect(await screen.findByText("Connected")).not.toBeNull();
  });
  it("a service that does not answer is not saved; the error is shown and Save anyway is offered", async () => {
    api.checkLyricsService.mockResolvedValue({ ok: false, message: "The service did not answer like LRCLIB (/get: HTTP 404)." });
    await open();
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: "https://bad.test" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    expect(await screen.findByText(/did not answer like LRCLIB/)).not.toBeNull();
    expect(api.saveSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
  });
  it("an empty address is saved without a check (lyrics files and uploads only)", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Lyrics service"), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(api.saveSettings.mock.calls[0]![0].lyrics_service_url).toBe(""));
    expect(api.checkLyricsService).not.toHaveBeenCalled();
  });
  it("has no page-wide save button", async () => {
    await open();
    expect(document.querySelector(".save-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  });
  it("shows Sign out and Change password in the account card, and the chips jump to a section", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Sign out" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Change password" })).not.toBeNull();
    act(() => { fireEvent.click(document.querySelector("[data-section='library'].snav-item")!); });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector("[data-section='library'].snav-item")!.getAttribute("aria-current")).toBe("true");
  });
  it("a guest sees Sign in and Create account instead", async () => {
    user = me({ is_guest: true, is_admin: false, display_name: "Guest" });
    await open();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.getByRole("link", { name: "Create account" })).not.toBeNull();
  });
});
