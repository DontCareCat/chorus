import { useCallback, useState } from "react";

const KEY = "chorus-swipe-hint";
/** The "Swipe for next" hint shows on this many game screens, then it has taught what it had to. */
export const HINT_SCREENS = 4;

/** Whether the hint is still due, given how many screens showed it (a stored count; anything unreadable counts as none). */
export const hintDue = (shownBefore: string | null): boolean => {
  const n = Number(shownBefore);
  return !(Number.isFinite(n) && n >= HINT_SCREENS);
};

const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (n: number) => { try { localStorage.setItem(KEY, String(n)); } catch { /* the hint may show once more */ } };

/** The hint under the player's left-swipe: shown on the first few game screens, never again after the player has swiped once. */
export function useSwipeHint(possible: boolean): { shown: boolean; used: () => void } {
  const [due] = useState(() => {
    const before = read();
    const d = hintDue(before);
    if (d) write((Number(before) || 0) + 1);
    return d;
  });
  const [swiped, setSwiped] = useState(false);
  const used = useCallback(() => { write(HINT_SCREENS); setSwiped(true); }, []);
  return { shown: possible && due && !swiped, used };
}
