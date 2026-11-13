import { en } from "../i18n/en";

/** What a playback error means for the player, with a way forward. Everything else about the audio is shown by the player itself (design guide section 23). */
export function describeError(error: string | null): string {
  const s = en.status;
  if (error?.includes("NotAllowedError")) return s.blocked; // autoplay policy: a click fixes it
  if (error?.includes("NotSupportedError") || error?.includes("audio error") || error?.includes("MEDIA_ERR")) return s.noAudio;
  return s.error;
}
