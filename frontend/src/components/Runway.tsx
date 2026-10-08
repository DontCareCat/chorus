import type { MouseEvent } from "react";
import type { Runway as RunwayData } from "../game/runway";

interface Props {
  runway: RunwayData;
  focusedId: number | null;
  onFocus: (id: number) => void;
  gated: boolean;
  /** Fraction 0..1 of the song; omitted/undefined while the audio is not loaded yet. */
  onSeek?: (fraction: number) => void;
}

/**
 * The song's timeline as a race: dots are lyric lines with questions (filled once all are answered), the orange
 * bar is the audio, the red marker is where the audio will stop and wait if the next open question is still
 * unanswered. Clicking the line moves through the song.
 */
export function Runway({ runway, focusedId, onFocus, gated, onSeek }: Props) {
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
  };
  return (
    <div className="runway" role="group" aria-label="Song timeline" data-seekable={!!onSeek} onClick={seek}>
      <div className="runway-track" />
      <div className="runway-done" style={{ width: `${runway.playheadPct}%` }} />
      {gated &&
        runway.ticks.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="runway-tick"
            data-qid={t.id}
            data-answered={t.answered}
            data-focus={t.id === focusedId}
            style={{ left: `${t.pct}%` }}
            aria-label={`Line ${i + 1}, ${t.count} ${t.count === 1 ? "question" : "questions"}${t.answered ? ", answered" : ", open"}`}
            onClick={(e) => {
              e.stopPropagation(); // a dot focuses its question; only the line itself seeks
              onFocus(t.id);
            }}
          />
        ))}
      {gated && runway.deadlinePct !== null && <div className="runway-deadline" style={{ left: `${runway.deadlinePct}%` }} title="The audio waits here" />}
      <div className="runway-playhead" style={{ left: `${runway.playheadPct}%` }} />
    </div>
  );
}
