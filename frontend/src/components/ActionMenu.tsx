import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import type { SheetApi } from "./Sheet";
import { swallowNextClick } from "../lib/swallow-click";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface ActionItem { id: string; icon: IconName; label: string; danger?: boolean }

interface Props {
  /** what the menu is for (read out by screen readers and shown as the title of the phone sheet) */
  label: string;
  phone: boolean;
  /** the button the menu belongs to (it opens under it) */
  anchor: HTMLElement | null;
  items: ActionItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}

const WIDTH = 260;

/** A small list of actions: a popover under its button on a PC, a bottom sheet on a phone (the same look as a song's ⋮ menu). */
export function ActionMenu({ label, phone, anchor, items, onPick, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<SheetApi>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    if (phone || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 160;
    const left = Math.min(Math.max(12, r.right - WIDTH), window.innerWidth - WIDTH - 12);
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  }, [phone, anchor]);

  useEffect(() => {
    if (phone) return; // the sheet closes itself (backdrop, handle, Esc)
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor?.contains(t)) { swallowNextClick(); onClose(); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose, phone]);

  const content = (
    <>
      {phone && <header className="sheet-head"><strong>{label}</strong></header>}
      {items.map((x) => (
        <button key={x.id} type="button" role="menuitem" className={`mi${x.danger ? " danger" : ""}`} onClick={() => { onPick(x.id); if (phone) sheet.current?.close(); else onClose(); }}>
          <Icon name={x.icon} /><span>{x.label}</span>
        </button>
      ))}
    </>
  );
  if (phone) return <Sheet ref={sheet} label={label} className="song-sheet" onClose={onClose}><div role="menu" aria-label={label}>{content}</div></Sheet>;
  return (
    <div className="song-menu" role="menu" aria-label={label} ref={box} style={{ left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, width: WIDTH }}>
      {content}
    </div>
  );
}
