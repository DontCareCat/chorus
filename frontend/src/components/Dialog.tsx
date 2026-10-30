import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { en } from "../i18n/en";
import { holdDialogOpen } from "../lib/dialog-open";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** The id of the text that explains the dialog, read out after its title. */
  describedBy?: string;
  children: ReactNode;
}

/** A window over the page (a bottom sheet with a draggable handle on phones) for one song tool. Esc, the close button and a click on the backdrop close it; the page behind does not scroll. */
export function Dialog({ title, subtitle, onClose, describedBy, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const phone = document.documentElement.dataset.layout === "phone";
  const closing = useRef(onClose);
  closing.current = onClose; // an inline onClose changes on every render; the effect must not re-run and pull focus back to the box
  useEffect(() => {
    if (phone) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!box.current?.contains(document.activeElement)) box.current?.focus(); // a control inside that asked for the focus keeps it
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closing.current(); };
    document.addEventListener("keydown", onKey);
    const release = holdDialogOpen();
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
      previous?.focus?.();
    };
  }, [phone]);

  const head = (
    <header className="dialog-head">
      <div className="dialog-title">
        <h2>{title}</h2>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {!phone && <button type="button" className="icon-btn" onClick={onClose} aria-label={en.dialog.close}><Icon name="close" /></button>}
    </header>
  );
  if (phone) {
    return (
      <Sheet label={title} className="tool-sheet" describedBy={describedBy} onClose={onClose}>
        {head}
        <div className="tool-body">{children}</div>
      </Sheet>
    );
  }
  return (
    <div className="dialog-scrim" data-kind="tool" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog tool-dialog" role="dialog" aria-modal="true" aria-label={title} aria-describedby={describedBy} ref={box} tabIndex={-1}>
        {head}
        <div className="tool-body">{children}</div>
      </div>
    </div>
  );
}
