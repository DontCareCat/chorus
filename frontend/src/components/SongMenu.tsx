import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import type { SongStatus } from "../lib/lyrics-status";
import { swallowNextClick } from "../lib/swallow-click";
import { paths } from "../router";
import type { SongDto } from "../services/api";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type SongAction = "lyrics" | "cover" | "language" | "metadata" | "remove";

interface Props {
  song: SongDto;
  status: SongStatus;
  phone: boolean;
  /** the ⋮ button the menu belongs to (the menu opens under it) */
  anchor: HTMLElement | null;
  onPick: (a: SongAction) => void;
  onClose: () => void;
}

const WIDTH = 296;

/** The ⋮ menu of a song: a popover under the button on a PC, a bottom sheet on a phone. Closes on a tap outside, a scroll or Esc. */
export function SongMenu({ song, status, phone, anchor, onPick, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    if (phone || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 300;
    const left = Math.min(Math.max(12, r.right - WIDTH), window.innerWidth - WIDTH - 12);
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  }, [phone, anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor?.contains(t)) { swallowNextClick(); onClose(); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    if (!phone) window.addEventListener("scroll", onClose, true);
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchor, onClose, phone]);

  const t = en.songMenu;
  const warn = (on: boolean) => on && <span className="mi-warn" data-kind={status.kind} title={t.needsAttention}><Icon name="warning" /><span className="sr-only">{t.needsAttention}</span></span>;
  const item = (icon: IconName, label: string, action: SongAction, extra?: React.ReactNode, cls?: string) => (
    <button type="button" role="menuitem" className={`mi${cls ? ` ${cls}` : ""}`} onClick={() => onPick(action)}>
      <Icon name={icon} /><span>{label}</span>{extra}
    </button>
  );
  const needsLyrics = status.fix === "lyrics";
  const menu = (
    <div className="song-menu" role="menu" aria-label={t.open(song.title)} ref={box} data-phone={phone} style={phone ? undefined : { left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, width: WIDTH }}>
      {phone && (
        <header className="sheet-head">
          <i className="grab" aria-hidden="true" />
          <strong>{song.title}</strong>
          <span className="muted">{song.artist}</span>
        </header>
      )}
      {item("search", status.kind === "warn" ? t.chooseLyrics : t.findLyrics, "lyrics", warn(needsLyrics))}
      {item("image", t.cover, "cover")}
      {item("language", t.language, "language")}
      {item("edit", t.metadata, "metadata")}
      <a role="menuitem" className="mi" href={paths.song(song.id)} onClick={onClose}><Icon name="clock" /><span>{t.timing}</span></a>
      <hr />
      {item("trash", t.remove, "remove", warn(status.fix === "file"), "danger")}
    </div>
  );
  return phone ? <div className="sheet-scrim">{menu}</div> : menu;
}
