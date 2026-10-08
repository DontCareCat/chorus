import { useCallback, useEffect, useState } from "react";
import type { PlaybackEngine } from "../services/audio/engine";
import {
  VOLUME_STORAGE_KEY, clampVolume, effectiveVolume, parseStoredVolume, serializeVolume, stepVolume,
} from "../game/volume";
import type { VolumeState } from "../game/volume";

const load = (): VolumeState => {
  try {
    return parseStoredVolume(localStorage.getItem(VOLUME_STORAGE_KEY));
  } catch {
    return parseStoredVolume(null); // storage blocked (private mode, ...): the control still works for this visit
  }
};

export interface UseVolume extends VolumeState {
  setVolume: (v: number) => void;
  toggleMute: () => void;
  step: (direction: 1 | -1) => void;
}

/**
 * The player's volume setting: remembered between visits, applied to the audio engine as soon as it exists.
 * Moving the slider while muted unmutes (what a player expects); the level is remembered while muted.
 */
export function useVolume(engine: PlaybackEngine | null): UseVolume {
  const [state, setState] = useState<VolumeState>(load);

  useEffect(() => {
    engine?.setMasterVolume(effectiveVolume(state));
  }, [engine, state]);

  useEffect(() => {
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, serializeVolume(state));
    } catch {
      /* not persisted this time; nothing else depends on it */
    }
  }, [state]);

  const setVolume = useCallback((v: number) => setState({ volume: clampVolume(v), muted: false }), []);
  const toggleMute = useCallback(() => setState((s) => ({ ...s, muted: !s.muted })), []);
  const step = useCallback(
    (direction: 1 | -1) => setState((s) => ({ volume: stepVolume(s.muted ? 0 : s.volume, direction), muted: false })),
    [],
  );
  return { ...state, setVolume, toggleMute, step };
}
