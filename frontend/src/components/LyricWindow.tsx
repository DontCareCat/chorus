import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { centerOffset, timecode } from "../game/lyric-window";
import type { WindowLine } from "../game/lyric-window";
import { en } from "../i18n/en";

interface Props {
  lines: readonly WindowLine[];
  /** Index of the line the window follows (the song's line, or the next question's while the player is answering ahead); it is kept in the middle. */
  current: number;
  synced: boolean;
  onFocus: (questionId: number) => void;
  /** Index of the line the song is singing (highlighted); -1 without synced lyrics. */
  playing: number;
  /** Index of the line of the question being answered (shown bigger); -1 when none is open, then the followed line is the big one. */
  asked: number;
  /** Changes when the window should take the reader back to its line at once (an answer was given). */
  pulse: number;
}

const MARKS: Record<string, { d: string; label: string }> = {
  correct: { d: "M2.5 7.4 5.6 10.5 11.5 3.8", label: "correct" },
  wrong: { d: "m3.5 3.5 7 7m0-7-7 7", label: "wrong" },
  partial: { d: "M2 8c1.6-3 3.2-3 5 0s3.4 3 5 0", label: "almost right" },
};

/** The plain tick, cross or wave after an answered word (design guide section 16): no background, the word's own colour, scaled with the line. */
function Mark({ state }: { state: string }) {
  const m = MARKS[state];
  if (!m) return null;
  return (
    <>
      <span className="lw-mark" aria-hidden="true">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={m.d} /></svg>
      </span>
      <span className="sr-only"> ({m.label})</span>
    </>
  );
}

/** One line of the window. Memoised: after an answer only the changed lines (and the ones whose distance from the current line changed) are redrawn. */
const LyricLine = memo(function LyricLine({ line: l, d, synced, playing, follow, onFocus }: { line: WindowLine; d: number; synced: boolean; playing: boolean; follow: boolean; onFocus: (questionId: number) => void }) {
  const body = (
    <>
      <time>{synced ? timecode(l.startTime) : ""}</time>
      <span>
        {l.parts.map((p, k) =>
          p.kind === "text" ? (
            <span key={k}>{p.text}</span>
          ) : p.kind === "blank" ? (
            <span key={k} className="lw-blank" data-focus={p.focused} aria-label="blank" />
          ) : (
            <span key={k} className="lw-word" data-state={p.state} data-focus={p.focused}>
              {p.word}
              <Mark state={p.state} />
            </span>
          ),
        )}
      </span>
    </>
  );
  return l.targetId === null ? (
    <div className="lw-line" data-d={d} data-status="plain" data-playing={playing} data-follow={follow} aria-current={playing || undefined}>{body}</div>
  ) : (
    <button
      type="button" className="lw-line" data-d={d} data-status={l.status} data-qid={l.targetId}
      data-focus={l.parts.some((p) => p.kind !== "text" && p.focused)} data-playing={playing} data-follow={follow} aria-current={playing || undefined} onClick={() => onFocus(l.targetId!)}
    >
      {body}
    </button>
  );
});

/** After the reader scrolls by hand the window leaves them alone until this long has passed without a touch, then follows the song again at the next line. */
export const BROWSE_IDLE_MS = 6000;

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

/**
 * The lyrics as a scrollable list. Two lines stand out: the one the song is singing is highlighted, the one with the question being answered
 * is bigger (the others get smaller and fainter the further they are from it). The line to follow (the song's own, or the next question's
 * when the player answers ahead of the song) is kept in the middle. Answered blanks
 * show the RIGHT word in the line itself, green if the player had it, red if not.
 *
 * The reader can scroll anywhere. Then the window stops following and a chip offers the way back; it follows again by itself at the next
 * line change once the reader has been idle for BROWSE_IDLE_MS, and at once when `pulse` changes (an answer was given).
 */
export const LyricWindow = memo(function LyricWindow({ lines, current, synced, onFocus, pulse, playing, asked }: Props) {
  const big = asked >= 0 ? asked : current; // the size follows the question being answered, the highlight the song
  const viewport = useRef<HTMLDivElement>(null);
  const browsing = useRef(false);
  const lastTouch = useRef(0);
  const lastPulse = useRef(pulse);
  const placed = useRef(false);
  const frame = useRef(0);
  const [away, setAway] = useState<"up" | "down" | null>(null);

  /** Where the followed line is relative to what can be seen, only while the reader is browsing. */
  const refreshAway = useCallback(() => {
    const vp = viewport.current;
    const el = vp?.querySelector<HTMLElement>('.lw-line[data-follow="true"]');
    if (!vp || !el || !browsing.current) return setAway(null);
    setAway(el.offsetTop + el.offsetHeight < vp.scrollTop ? "up" : el.offsetTop > vp.scrollTop + vp.clientHeight ? "down" : null);
  }, []);

  const place = useCallback((smooth: boolean) => {
    const vp = viewport.current;
    const el = vp?.querySelector<HTMLElement>('.lw-line[data-follow="true"]');
    if (!vp || !el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    vp.scrollTo({ top: centerOffset(vp.clientHeight, el.offsetTop, el.offsetHeight) * -1, behavior: smooth && !reduced ? "smooth" : "auto" });
  }, []);

  // The window follows its line unless the reader has taken over.
  useLayoutEffect(() => {
    const pulsed = lastPulse.current !== pulse;
    lastPulse.current = pulse;
    if (browsing.current) {
      if (!pulsed && performance.now() - lastTouch.current < BROWSE_IDLE_MS) return;
      browsing.current = false;
      setAway(null);
    }
    place(placed.current);
    placed.current = true;
    // the line grows while it becomes the current one (font-size transition), which moves it: settle once more afterwards
    const t = setTimeout(() => { if (!browsing.current) place(true); }, 350);
    return () => clearTimeout(t);
  }, [current, lines, pulse, place]);

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => { if (!browsing.current) place(false); });
    ro.observe(vp);
    return () => { ro.disconnect(); cancelAnimationFrame(frame.current); };
  }, [place]);

  const touched = () => {
    browsing.current = true;
    lastTouch.current = performance.now();
  };
  const back = () => {
    browsing.current = false;
    setAway(null);
    place(true);
  };

  return (
    <section aria-labelledby="lw-title">
      <h3 className="lw-title" id="lw-title">{en.game.sheet}</h3>
      <div
        className="lyric-window" ref={viewport}
        onWheel={touched} onTouchMove={touched}
        onKeyDown={(e) => { if (SCROLL_KEYS.has(e.key)) touched(); }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) touched(); }} /* the scrollbar itself */
        onScroll={() => { if (browsing.current) { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(refreshAway); } }}
      >
        <div className="lw-track">
          {lines.map((l, i) => (
            <LyricLine key={l.lineId} line={l} d={Math.min(3, Math.abs(i - big))} synced={synced} playing={i === playing} follow={i === current} onFocus={onFocus} />
          ))}
        </div>
      </div>
      {away && (
        <button type="button" className="chip-float" data-dir={away === "up" ? "up" : "down"} onClick={back}>
          {en.game.backToLine}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={away === "down" ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} /></svg>
        </button>
      )}
    </section>
  );
});
