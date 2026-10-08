export const VOLUME_STEP = 0.05;
export const DEFAULT_VOLUME = 1;
export const VOLUME_STORAGE_KEY = "chorus.volume";

export const clampVolume = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : DEFAULT_VOLUME));

/** One keyboard / wheel step, kept on a clean 5% grid (0.1 + 0.2 style float drift is rounded away). */
export const stepVolume = (v: number, direction: 1 | -1): number => clampVolume(Math.round((v + direction * VOLUME_STEP) * 100) / 100);

export type VolumeIconName = "volumeOff" | "volumeMute" | "volumeDown" | "volumeUp";

/** Which speaker icon to show: crossed out when muted or at 0, then growing with the level. */
export function volumeIcon(volume: number, muted: boolean): VolumeIconName {
  if (muted || volume <= 0) return "volumeOff";
  if (volume < 0.25) return "volumeMute";
  if (volume < 0.65) return "volumeDown";
  return "volumeUp";
}

export interface VolumeState {
  volume: number;
  muted: boolean;
}

/** What the audio actually gets: nothing while muted. The slider keeps showing the remembered level. */
export const effectiveVolume = (s: VolumeState): number => (s.muted ? 0 : s.volume);

/** Read the saved setting; anything missing or malformed falls back to full volume, unmuted. */
export function parseStoredVolume(raw: string | null): VolumeState {
  if (raw === null) return { volume: DEFAULT_VOLUME, muted: false };
  try {
    const j = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
    return {
      volume: typeof j.volume === "number" ? clampVolume(j.volume) : DEFAULT_VOLUME,
      muted: j.muted === true,
    };
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false };
  }
}

export const serializeVolume = (s: VolumeState): string => JSON.stringify({ volume: clampVolume(s.volume), muted: s.muted });
