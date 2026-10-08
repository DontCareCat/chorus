import { useLayoutEffect, useRef, useState } from "react";
import { centerOffset, timecode } from "../game/lyric-window";
import type { WindowLine } from "../game/lyric-window";
import { en } from "../i18n/en";

interface Props {
  lines: readonly WindowLine[];
  /** Index of the line the song is at; the window keeps it in the middle. */
  current: number;
  synced: boolean;
  onFocus: (questionId: number) => void;
}

/**
 * The lyrics as a sliding window: the line being sung is in the middle, larger and in full contrast; the others get
 * smaller and fainter the further they are. Answered blanks show the RIGHT word in the line itself, green if the
 * player had it, red if not.
 */
export function LyricWindow({ lines, current, synced, onFocus }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const vp = viewport.current;
    const tr = track.current;
    if (!vp || !tr) return;
    const place = () => {
      const el = tr.children[current] as HTMLElement | undefined;
      if (el) setShift(centerOffset(vp.clientHeight, el.offsetTop, el.offsetHeight));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [current, lines.length]);

  return (
    <section aria-labelledby="lw-title">
      <h3 className="lw-title" id="lw-title">{en.game.sheet}</h3>
      <div className="lyric-window" ref={viewport}>
        <div className="lw-track" ref={track} style={{ transform: `translateY(${shift}px)` }}>
          {lines.map((l, i) => {
            const d = Math.min(3, Math.abs(i - current));
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
                      <span key={k} className="lw-word" data-state={p.state} data-focus={p.focused}>{p.word}</span>
                    ),
                  )}
                </span>
              </>
            );
            return l.targetId === null ? (
              <div key={l.lineId} className="lw-line" data-d={d} data-status="plain" aria-current={d === 0}>{body}</div>
            ) : (
              <button
                key={l.lineId} type="button" className="lw-line" data-d={d} data-status={l.status} data-qid={l.targetId}
                data-focus={l.parts.some((p) => p.kind !== "text" && p.focused)} aria-current={d === 0} onClick={() => onFocus(l.targetId!)}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
