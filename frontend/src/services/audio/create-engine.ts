import type { GameEngine } from "./engine";
import { HtmlAudioPlaybackEngine } from "./html-audio-engine";
import { WebAudioPlaybackEngine } from "./web-audio-engine";

/** "webaudio": smooth fades through Web Audio (default). "direct": the plain <audio> path, stepped fades. */
export type EngineKind = "webaudio" | "direct";
const KEY = "chorus-audio-engine";

/** A per-device choice (what sounds right differs from device to device), kept in this browser only. */
export function getEngineKind(): EngineKind {
  try {
    return localStorage.getItem(KEY) === "direct" ? "direct" : "webaudio";
  } catch {
    return "webaudio";
  }
}

export function setEngineKind(kind: EngineKind): void {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    /* blocked storage: the choice lasts until the page is reloaded */
  }
}

/**
 * An audio context for a song: a deep buffer ("playback": no glitches from main-thread work, latency does not matter
 * here) at the file's own sample rate, so the graph does not resample. Falls back step by step to what the browser accepts.
 */
export function makeAudioContext(sampleRate?: number | null): AudioContext {
  const attempts: AudioContextOptions[] = [];
  if (sampleRate) attempts.push({ latencyHint: "playback", sampleRate });
  attempts.push({ latencyHint: "playback" });
  for (const options of attempts) {
    try {
      return new AudioContext(options);
    } catch {
      /* the browser does not take this combination: try the next */
    }
  }
  return new AudioContext();
}

export function createEngine(audio: HTMLAudioElement, kind: EngineKind, sampleRate?: number | null): GameEngine {
  if (kind === "direct") return new HtmlAudioPlaybackEngine(audio);
  return new WebAudioPlaybackEngine(audio, makeAudioContext(sampleRate), true);
}
