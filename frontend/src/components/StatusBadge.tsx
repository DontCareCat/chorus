import { useEffect, useRef, useState } from "react";
import { swallowNextClick } from "../lib/swallow-click";
import type { SongStatus } from "../lib/lyrics-status";
import { Icon } from "./Icon";

interface Props {
  status: SongStatus;
  phone: boolean;
  /** open the dialog (or do the action) that fixes the problem */
  onFix: () => void;
}

const BUBBLE_W = 288;
const MARGIN = 12;
const GAP = 10;

interface Box { left: number; top?: number; bottom?: number; arrow: number; below: boolean }

/**
 * The lyrics status of a song, only while it is not ready: a tag in the song's tag row (same look as every other tag) with an icon
 * (clock while the search runs, warning in yellow when you can fix it, warning in red when it cannot be played) and a few words.
 * A tap opens a bubble with the title, the message and a highlighted fix button: above the tag on a phone (with an arrow), under it
 * on a PC. The open tag is inverse; a tap outside, a scroll or Esc closes the bubble.
 */
export function StatusBadge({ status, phone, onFix }: Props) {
  const [box, setBox] = useState<Box | null>(null);
  const tag = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const open = box !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setBox(null);
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!bubble.current?.contains(t) && !tag.current?.contains(t)) { swallowNextClick(); close(); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (status.kind === "ready") return null;

  const toggle = () => {
    if (open) return setBox(null);
    const r = tag.current?.getBoundingClientRect();
    if (!r) return;
    const centre = r.left + r.width / 2;
    const left = Math.min(Math.max(MARGIN, r.left), window.innerWidth - MARGIN - BUBBLE_W);
    const arrow = Math.min(Math.max(centre - left - 7, 14), BUBBLE_W - 28);
    // a phone's bubble sits above the tag; a PC's under it (above when there is no room below)
    const below = !phone && r.bottom + GAP + 160 < window.innerHeight;
    setBox(below ? { left, top: r.bottom + GAP, arrow, below } : { left, bottom: window.innerHeight - r.top + GAP, arrow, below });
  };

  return (
    <>
      <button
        type="button" ref={tag} className="tag status-tag" data-kind={status.kind} data-open={open || undefined} onClick={toggle}
        aria-expanded={open} aria-haspopup="true" aria-label={`${status.short}. ${status.full}`}
      >
        <span className={status.kind === "pending" ? "wait" : undefined}><Icon name={status.kind === "pending" ? "clock" : "warning"} /></span>
        {status.tag}
      </button>
      {box && (
        <div ref={bubble} className="status-bubble" role="status" data-below={box.below || undefined} style={{ left: box.left, top: box.top, bottom: box.bottom, width: BUBBLE_W }}>
          <strong>{status.short}</strong>
          {status.full}
          {status.fix && <button type="button" className="btn small" onClick={() => { setBox(null); onFix(); }}>{status.fixLabel}</button>}
          <i className="arrow" style={{ left: box.arrow }} aria-hidden="true" />
        </div>
      )}
    </>
  );
}
