/** Small per-device choices of the timing editor (local storage; every access guarded: it can be blocked). */
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

/** The NEW badge on "Edit lyrics timing" shows for the first 3 times the song menu is opened after the update. */
export const NEW_BADGE_OPENS = 3;
const SEEN = "timing_new_seen";

/** Whether the badge shows in this menu; counts this opening once per page view of the menu (call it when the menu mounts). */
export function timingBadgeShown(): boolean {
  const n = Number(get(SEEN) ?? "0") || 0;
  return n < NEW_BADGE_OPENS;
}
export function markTimingSeen(): void { set(SEEN, String(NEW_BADGE_OPENS)); }
/** One more opening of the menu (call once when it opens). */
export function countMenuOpen(): void { const n = Number(get(SEEN) ?? "0") || 0; if (n < NEW_BADGE_OPENS) set(SEEN, String(n + 1)); }

export const tipClosed = (): boolean => get("timing_tip_closed") === "1";
export const closeTip = (): void => set("timing_tip_closed", "1");
export const rippleOn = (): boolean => get("timing_ripple") === "1";
export const setRipple = (on: boolean): void => set("timing_ripple", on ? "1" : "0");
