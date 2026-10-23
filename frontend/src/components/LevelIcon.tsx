import { en } from "../i18n/en";

export type Level = "easy" | "medium" | "hard" | "expert";
export type QueueLevel = Level | "progressive";
export const LEVELS: readonly Level[] = ["easy", "medium", "hard", "expert"];

/** Four bars, 1 to 4 filled for Easy to Expert (design guide section 19). */
export function LevelBars({ level, size = 16 }: { level: Level; size?: number }) {
  const n = LEVELS.indexOf(level) + 1;
  return (
    <svg className="level-bars" width={size} height={size} viewBox="0 0 20 18" fill="none" aria-hidden="true" focusable="false">
      {[5, 8, 11, 14].map((h, i) => <rect key={i} x={2 + i * 4.5} y={16 - h} width="3" height={h} rx="1" fill="currentColor" opacity={i < n ? 1 : 0.25} />)}
    </svg>
  );
}

/** Two stars: the difficulty follows the player (it goes up after a good game). */
export function ProgressiveStars({ size = 16 }: { size?: number }) {
  return (
    <svg className="level-stars" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M7.5 3.5l1.5 3.6 3.6 1.5-3.6 1.5-1.5 3.6-1.5-3.6L2.4 8.6l3.6-1.5 1.5-3.6Z" fill="currentColor" />
      <path d="M14.8 10.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" fill="currentColor" />
    </svg>
  );
}

/** The level meter with its name; for Progressive, the two stars to the right of the name. */
export function LevelLabel({ level, progressive = false, size }: { level: Level; progressive?: boolean; size?: number }) {
  return (
    <span className="level-label" title={progressive ? `${en.queue.progressive}: ${en.library.difficulty[level]}` : en.library.difficulty[level]}>
      <LevelBars level={level} size={size} />
      <span>{en.library.difficulty[level]}</span>
      {progressive && <ProgressiveStars size={size} />}
    </span>
  );
}
