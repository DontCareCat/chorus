// Scoring rules. Mirrors backend app/services/game/scoring.py; both are tested against shared/scoring-vectors.json.
// The server is authoritative; the browser uses decay() and multiplierFor() to show the multiplier while the game waits.

export const POINTS = 10;
export const AHEAD_BONUS = 15;
export const STREAK_STEP = 4; // correct answers in a row per multiplier level
export const MAX_MULTIPLIER = 8;
export const DECAY_SECONDS = 5; // waiting time that costs one level
export const MAX_WAIT_SECONDS = 600;

export const multiplierFor = (streak: number): number => Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_STEP));

/** The streak after `waited` seconds of the game waiting for an answer: one level lost per DECAY_SECONDS, progress cleared. */
export function decay(streak: number, waited: number): number {
  const levels = Math.floor(Math.max(0, Math.min(waited, MAX_WAIT_SECONDS)) / DECAY_SECONDS);
  let s = streak;
  for (let i = 0; i < levels; i++) {
    const level = multiplierFor(s);
    s = level > 1 ? STREAK_STEP * (level - 2) : 0;
  }
  return s;
}

export interface Outcome {
  points: number;
  multiplier: number; // applied to this answer
  streak: number; // afterwards
  nextMultiplier: number;
}

export function scoreAnswer(streak: number, correct: boolean, ahead: boolean, waited = 0): Outcome {
  const decayed = decay(streak, waited);
  const applied = multiplierFor(decayed);
  if (!correct) return { points: 0, multiplier: applied, streak: 0, nextMultiplier: 1 };
  const next = decayed + 1;
  return { points: (POINTS + (ahead ? AHEAD_BONUS : 0)) * applied, multiplier: applied, streak: next, nextMultiplier: multiplierFor(next) };
}

/** Correct answers still needed for the next multiplier level (0 at the maximum). */
export function untilNextLevel(streak: number): number {
  return multiplierFor(streak) >= MAX_MULTIPLIER ? 0 : STREAK_STEP - (streak % STREAK_STEP);
}

/** Seconds until the game's waiting costs the next multiplier level, counting from `waited` seconds of waiting. */
export const secondsToDecay = (waited: number): number => DECAY_SECONDS - (waited % DECAY_SECONDS);
