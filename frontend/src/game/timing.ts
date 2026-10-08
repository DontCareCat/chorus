/** The 3-second rule: audio may run this far past the earliest unanswered question's end. */
export const SYNC_GRACE_PERIOD = 3;
export const FADE_OUT_MS = 400;
export const FADE_IN_MS = 400;
/** "Back" in the transport bar goes this far back. */
export const REWIND_SECONDS = 5;
/** How often the engine's real position is polled (never used to *derive* the position). */
export const POLL_INTERVAL_MS = 150;

/**
 * Lyric time → audio time. This is the ONLY place the per-song offset is applied.
 * Convention: audioTime = lyricTime + offset (positive offset = lyrics were too early, shift them later).
 */
export function toAudioTime(lyricTime: number, offset: number): number {
  return Math.max(0, lyricTime + offset);
}
