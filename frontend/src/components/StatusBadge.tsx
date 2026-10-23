import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
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

/**
 * The lyrics status of a song, only while it is not ready. It always sits in the same slot next to the ⋮ button.
 * Loading: the spinner (with its words on a PC). Problem: a yellow (you can fix it) or red (it cannot be played) warning icon.
 * PC: the short message beside the icon, the full message on hover, a click opens the fix. Phone: a tap on the icon opens a
 * bubble right above it, with the message and a highlighted fix button; any tap outside it, a scroll or Esc closes it.
 */
export function StatusBadge({ status, phone, onFix }: Props) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; bottom: number; arrow: number } | null>(null);
  const icon = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!bubble.current?.contains(t) && !icon.current?.contains(t)) close();
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
  if (status.kind === "pending") {
    return (
      <div className="status-slot" data-kind="pending" role="status">
        <span className="spin"><Icon name="spinner" /></span>
        {!phone && <span className="status-text">{status.short}</span>}
        {phone && <span className="sr-only">{status.short}</span>}
      </div>
    );
  }

  const toggle = () => {
    if (!phone) return onFix();
    const r = icon.current?.getBoundingClientRect();
    if (!r) return;
    const centre = r.left + r.width / 2;
    const left = Math.min(Math.max(MARGIN, centre - BUBBLE_W + 28), window.innerWidth - MARGIN - BUBBLE_W); // as far right as the screen allows, the arrow stays on the icon
    setBox({ left, bottom: window.innerHeight - r.top + 10, arrow: Math.min(Math.max(centre - left - 7, 14), BUBBLE_W - 28) });
    setOpen((v) => !v);
  };

  return (
    <div className="status-slot" data-kind={status.kind} data-phone={phone}>
      <button
        type="button" ref={icon} className="status-btn" data-kind={status.kind} onClick={toggle} aria-expanded={phone ? open : undefined}
        aria-label={`${status.short}. ${status.full}`} title={phone ? undefined : status.full}
      >
        <Icon name="warning" />
        {!phone && <span className="status-text">{status.short}</span>}
      </button>
      {!phone && (
        <div className="status-tip" role="tooltip">
          <strong>{status.short}</strong>
          {status.full}
          {status.fix && <em>{en.songStatus.click(status.fixLabel)}</em>}
        </div>
      )}
      {phone && open && box && (
        <div ref={bubble} className="status-bubble" role="status" style={{ left: box.left, bottom: box.bottom, width: BUBBLE_W }}>
          <strong>{status.short}</strong>
          {status.full}
          {status.fix && <button type="button" className="btn small" onClick={() => { setOpen(false); onFix(); }}>{status.fixLabel}</button>}
          <i className="arrow" style={{ left: box.arrow }} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
