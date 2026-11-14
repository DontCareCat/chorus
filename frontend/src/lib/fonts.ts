/** The weights a lyric line passes through while its weight animates (400 to 700, the answered words 700) in both scripts the bundled font has. */
const WEIGHTS = [400, 500, 600, 700];
const SAMPLES = ["a", "\u0142"]; // Latin, Latin Extended

let started = false;
/** Loads every face of the lyric window before a line first changes weight: a face that loads in the middle of the animation shows the fallback font for a moment, with other widths. */
export function preloadLyricFonts(): void {
  if (started || typeof document === "undefined" || !document.fonts?.load) return;
  started = true;
  for (const w of WEIGHTS) for (const s of SAMPLES) void document.fonts.load(`${w} 16px Inconsolata`, s).catch(() => undefined);
}
