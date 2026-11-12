import { useCallback, useState } from "react";
import type { LyricFocus } from "../game/lyric-window";

const KEY = "chorus-lyric-focus";

export const parseLyricFocus = (v: string | null): LyricFocus => (v === "line" ? "line" : "question");

const stored = (): LyricFocus => {
  try { return parseLyricFocus(localStorage.getItem(KEY)); } catch { return "question"; }
};

/** What the lyric window keeps in the middle (Settings > Game): the next question (default) or the line being sung. Remembered on this device. */
export function useLyricFocus(): { focus: LyricFocus; setFocus: (f: LyricFocus) => void } {
  const [focus, set] = useState<LyricFocus>(stored);
  const setFocus = useCallback((f: LyricFocus) => {
    try { localStorage.setItem(KEY, f); } catch { /* lasts for this visit only */ }
    set(f);
  }, []);
  return { focus, setFocus };
}
