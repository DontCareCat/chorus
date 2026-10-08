export type EngineState = "idle" | "playing" | "paused" | "buffering" | "ended";
export type Unsubscribe = () => void;

/**
 * Everything the game needs from audio playback. Production: Web Audio over a local <audio>;
 * tests: FakePlaybackEngine. Game logic depends on this interface only.
 */
export interface PlaybackEngine {
  play(): Promise<void>; // rejects if the browser blocks playback (autoplay policy)
  pause(): void;
  seek(time: number): Promise<void>; // resolves once the position has actually changed (`seeked`)

  getCurrentTime(): number; // authoritative position, read from the real engine
  getDuration(): number;
  getPlaybackRate(): number;

  /** Ramp the gain smoothly. Resolve `true` when finished, `false` when cancelled/superseded. */
  fadeOut(durationMs: number): Promise<boolean>;
  fadeIn(durationMs: number): Promise<boolean>;
  /** Stop any running fade and freeze the gain at its current value (never jump). */
  cancelFade(): void;
  setVolume(volume: number): void; // the FADE gain (the game ramps it 0 ↔ 1); not the player's volume setting
  getVolume(): number;

  /** The player's volume setting, 0..1, applied on top of the fades (a separate gain stage, so a fade never
   *  overrides it and it never disturbs a fade). Changes are smoothed to avoid clicks. */
  setMasterVolume(volume: number): void;
  getMasterVolume(): number;

  onStateChange(cb: (state: EngineState) => void): Unsubscribe;
  onError(cb: (message: string) => void): Unsubscribe;
}

/** What the game page holds on to: the playback interface plus clean-up and a level reading for diagnostics. */
export interface GameEngine extends PlaybackEngine {
  /** RMS of what is leaving the volume stages, 0..1 (an estimate for the direct engine). */
  getOutputLevel(): number;
  dispose(): void;
}
