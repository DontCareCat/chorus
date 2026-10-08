import { decay, DECAY_SECONDS, MAX_MULTIPLIER, multiplierFor, STREAK_STEP, secondsToDecay, untilNextLevel } from "../game/scoring";
import type { Gain, Standing } from "../hooks/useGame";
import { en } from "../i18n/en";

interface Props {
  standing: Standing;
  /** Seconds the game has been waiting for an answer since the last answer. */
  waited: number;
  /** The audio is paused and waits for the player: the multiplier is draining. */
  waiting: boolean;
  gain: Gain | null;
}

/** Points, the multiplier with its progress to the next level, and the countdown that eats it while the game waits. */
export function ScorePanel({ standing, waited, waiting, gain }: Props) {
  const streak = decay(standing.streak, waited); // what the multiplier is worth right now
  const level = multiplierFor(streak);
  const into = level >= MAX_MULTIPLIER ? STREAK_STEP : streak % STREAK_STEP;
  const left = secondsToDecay(waited);
  const next = untilNextLevel(streak);
  const draining = waiting && streak > 0;
  return (
    <div className="score-panel" role="group" aria-label={en.game.points}>
      <div className="score-points" aria-live="off">
        <small>{en.game.points}</small>
        <span data-testid="points">{standing.points}</span>
      </div>
      <div className="multiplier">
        <span className="mult-badge" data-level={level} data-testid="multiplier" aria-label={`${en.game.multiplier} x${level}`}>x{level}</span>
        <span className="pips" title={next === 0 ? en.game.maxLevel : en.game.nextLevel(next)}>
          {Array.from({ length: STREAK_STEP }, (_, i) => <i key={i} data-on={i < into} />)}
        </span>
      </div>
      <span className="countdown" hidden={!draining} aria-label={en.game.countdownLabel} data-testid="countdown">
        <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, left / DECAY_SECONDS))})` }} />
      </span>
      {gain && (
        <span className="gain" key={gain.id} data-ok={gain.correct} role="status">
          {gain.correct ? en.game.gain(gain.points, gain.multiplier) : "✗"}
          {gain.correct && gain.ahead && <small> {en.game.ahead}</small>}
        </span>
      )}
    </div>
  );
}
