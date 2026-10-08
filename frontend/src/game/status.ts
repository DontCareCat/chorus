import { en } from "../i18n/en";
import type { PlaybackStateName } from "./playback-state-machine";
import type { Runway } from "./runway";

export type StatusTone = "calm" | "warn" | "wait";

export interface StatusLine {
  text: string;
  tone: StatusTone;
}

/** One sentence that tells the player what the audio is doing and why. */
export function describeStatus(input: {
  state: PlaybackStateName;
  error: string | null;
  runway: Runway | null; // null in free play
  freePlay: boolean;
  /** A narrow screen: one short line instead of a sentence. */
  short?: boolean;
}): StatusLine {
  const { state, error, runway, freePlay, short } = input;
  const s = en.status;
  switch (state) {
    case "IDLE":
      return { text: s.idle, tone: "calm" };
    case "PAUSED":
      return { text: s.paused, tone: "calm" };
    case "FADING_OUT":
      return { text: s.pausing, tone: "wait" };
    case "SEEKING":
      return { text: s.rewinding, tone: "wait" };
    case "PAUSED_FOR_QUESTION":
      return { text: short ? s.waitingShort : s.waiting, tone: "wait" };
    case "FADING_IN":
      return { text: s.resuming, tone: "calm" };
    case "ERROR":
      if (error?.includes("NotAllowedError")) return { text: s.blocked, tone: "warn" }; // autoplay policy: a click fixes it
      if (error?.includes("NotSupportedError") || error?.includes("audio error") || error?.includes("MEDIA_ERR")) return { text: s.noAudio, tone: "warn" };
      return { text: s.error, tone: "warn" };
    case "PLAYING": {
      if (freePlay || !runway || runway.slack === null) return { text: freePlay ? en.game.freePlay : s.allAnswered, tone: "calm" };
      if (runway.ahead !== null && runway.ahead > 0) return { text: s.ahead(Math.round(runway.ahead)), tone: "calm" };
      const secs = Math.max(0, Math.ceil(runway.slack));
      return { text: s.closing(secs), tone: runway.slack < 3 ? "warn" : "calm" };
    }
  }
}
