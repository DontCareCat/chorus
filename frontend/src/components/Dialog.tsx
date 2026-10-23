import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { en } from "../i18n/en";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/** A window over the page (a bottom sheet with a draggable handle on phones) for one song tool. Esc, the close button and a click on the backdrop close it; the page behind does not scroll. */
export function Dialog({ title, subtitle, onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const phone = document.documentElement.dataset.layout === "phone";
  useEffect(() => {
    if (phone) return;
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("dialog-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("dialog-open");
      previous?.focus?.();
    };
  }, [onClose, phone]);

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
      <Sheet label={title} className="tool-sheet" onClose={onClose}>
        {head}
        <div className="tool-body">{children}</div>
      </Sheet>
    );
  }
  return (
    <div className="dialog-scrim" data-kind="tool" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog tool-dialog" role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        {head}
        <div className="tool-body">{children}</div>
      </div>
    </div>
  );
}
