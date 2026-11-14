import { api } from "../services/api";
import type { SettingsDto } from "../services/api";

/**
 * How the lyrics-source window reaches the lyrics service setting. This file is the web version; the phone app has its own copy
 * (its setting is stored under another key and its check runs through the phone's own networking).
 */
export const configuredService = (s: SettingsDto): string => (s.lyrics_service_url ?? "").trim();

/** Does the address answer like an LRCLIB-compatible service? */
export const checkService = (url: string): Promise<{ ok: boolean; message: string }> => api.checkLyricsService(url);

/** Save the address as the lyrics service (the other settings stay as they are). */
export async function saveService(url: string): Promise<void> {
  const current = await api.settings();
  await api.saveSettings({ ...current, lyrics_service_url: url });
}

/** The current lyrics service address ("" = none). */
export async function loadService(): Promise<string> {
  return configuredService(await api.settings());
}
