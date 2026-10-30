import { useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "./Cover";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { LEVELS, LevelLabel, ProgressiveStars } from "./LevelIcon";
import type { Level } from "./LevelIcon";
import { Select } from "./Select";
import { Sheet } from "./Sheet";
import type { SheetApi } from "./Sheet";
import { useQueue } from "../hooks/useQueue";
import { useReorder } from "../hooks/useReorder";
import { useSwipe } from "../hooks/useSwipe";
import { en } from "../i18n/en";
import { progressiveLevel } from "../lib/progressive";
import * as Q from "../lib/queue";
import type { QueueItem, QueueLevel, QueueMode } from "../lib/queue";
import type { GameSummaryDto, SongDto } from "../services/api";

interface Props {
  songs: SongDto[];
  games: GameSummaryDto[];
  phone: boolean;
  onClose: () => void;
}

const levelOptions = (resolved: Level) => [
  { value: "progressive" as QueueLevel, label: en.queue.progressive, node: <LevelLabel level={resolved} progressive /> },
  ...LEVELS.map((l) => ({ value: l as QueueLevel, label: en.library.difficulty[l]!, node: <LevelLabel level={l} /> })),
];

/** The queue: waiting songs in order, each with its difficulty; drag to reorder, swipe left (touch) or the cross to remove; ⋮ changes every song at once. */
export function QueuePanel({ songs, games, phone, onClose }: Props) {
  const store = useQueue();
  const q = store.queue;
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const waiting = Q.upcoming(q);
  const list = useRef<HTMLUListElement>(null);
  const moved = useReorder(list, { ids: waiting.map((i) => i.songId), enabled: waiting.length > 1, mode: phone ? "press" : "grip", onReorder: store.reorder });
  const [menu, setMenu] = useState<"root" | "difficulty" | "mode" | null>(null);
  const menuAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => { // a tap outside the menu closes it
    if (!menu) return;
    const down = (e: PointerEvent) => { if (!menuAnchor.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [menu]);
  const [undo, setUndo] = useState<{ label: string; prev: Q.QueueState } | null>(null);
  const remember = (label: string, next: Q.QueueState) => { setUndo({ label, prev: q }); store.set(next); };
  const resolved = (i: QueueItem): Level => progressiveLevel(games, i.songId, i.mode);

  const menuPanel = menu && (
    <div className="queue-menu" role="menu" aria-label={en.queue.menu}>
      {menu === "root" && (
        <>
          <button type="button" role="menuitem" className="mi" onClick={() => setMenu("difficulty")}><Icon name="tune" /><span>{en.queue.forAll.difficulty}</span><span className="mi-more">›</span></button>
          <button type="button" role="menuitem" className="mi" onClick={() => setMenu("mode")}><Icon name="tune" /><span>{en.queue.forAll.mode}</span><span className="mi-more">›</span></button>
          <hr />
          <button type="button" role="menuitem" className="mi" disabled={waiting.length < 2} onClick={() => { remember(en.queue.changed, { ...q, items: [...q.items.slice(0, q.cursor), ...Q.shuffled(waiting, (Math.random() * 2 ** 32) >>> 0)] }); setMenu(null); }}><Icon name="shuffle" /><span>{en.queue.shuffleOrder}</span></button>
          <button type="button" role="menuitem" className="mi danger" onClick={() => { remember(en.queue.cleared, Q.EMPTY); setMenu(null); }}><Icon name="trash" /><span>{en.queue.clear}</span></button>
        </>
      )}
      {menu === "difficulty" && (
        <>
          <button type="button" className="mi back" onClick={() => setMenu("root")}>‹ {en.queue.forAll.difficulty}</button>
          {levelOptions("medium").map((o) => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={Q.shared(q, "difficulty") === o.value} className="mi"
              onClick={() => { remember(en.queue.changed, Q.setAllUpcoming(q, { difficulty: o.value })); setMenu(null); }}>
              <span className="mi-node">{o.value === "progressive" ? <span className="level-label"><ProgressiveStars /><span>{o.label}</span></span> : o.node}</span>
              {Q.shared(q, "difficulty") === o.value && <Icon name="check" />}
            </button>
          ))}
        </>
      )}
      {menu === "mode" && (
        <>
          <button type="button" className="mi back" onClick={() => setMenu("root")}>‹ {en.queue.forAll.mode}</button>
          {(["choice", "typing"] as QueueMode[]).map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={Q.shared(q, "mode") === m} className="mi"
              onClick={() => { remember(en.queue.changed, Q.setAllUpcoming(q, { mode: m })); setMenu(null); }}>
              <span>{en.library.modes[m].name}</span>
              {Q.shared(q, "mode") === m && <Icon name="check" />}
            </button>
          ))}
        </>
      )}
    </div>
  );

  const body = (
    <div className="queue-body">
      <div className="queue-toolbar">
        <span className="muted">{en.queue.waiting(waiting.length)}</span>
        <div className="queue-menu-anchor" ref={menuAnchor}>
          <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={menu !== null} aria-label={en.queue.menu} onClick={() => setMenu(menu ? null : "root")}><Icon name="more" /></button>
          {menuPanel}
        </div>
      </div>
        {waiting.length === 0 && <p className="muted">{en.queue.empty}</p>}
        <ul className="queue-list" ref={list} data-orderable={waiting.length > 1}>
          {waiting.map((item) => {
            const s = byId.get(item.songId);
            return <QueueRow key={item.songId} item={item} song={s} phone={phone} orderable={waiting.length > 1 && !phone} resolved={resolved(item)}
              onLevel={(difficulty) => store.set(Q.setItem(q, item.songId, { difficulty }))}
              onRemove={() => { const at = q.items.findIndex((i) => i.songId === item.songId); remember(en.queue.removed(s?.title ?? ""), Q.removeAt(q, at)); }}
              onTop={() => store.set(Q.moveToTop(q, item.songId))} />;
          })}
        </ul>
        <div className="sr-only" role="status" aria-live="polite">{moved}</div>
        {undo && <div className="toast" role="status"><span>{undo.label}</span><button type="button" className="btn quiet small" onClick={() => { store.set(undo.prev); setUndo(null); }}>{en.queue.undo}</button></div>}
    </div>
  );
  return <Dialog title={en.queue.title} onClose={onClose}>{body}</Dialog>;
}

function QueueRow({ item, song, phone, orderable, resolved, onLevel, onRemove, onTop }: { item: QueueItem; song: SongDto | undefined; phone: boolean; orderable: boolean; resolved: Level; onLevel: (l: QueueLevel) => void; onRemove: () => void; onTop: () => void }) {
  const li = useRef<HTMLLIElement>(null);
  useSwipe(li, { directions: ["left"], onSwipe: onRemove, enabled: phone });
  const [open, setOpen] = useState(false);
  const title = song?.title ?? "?";
  return (
    <li className="queue-row" ref={li} data-reorder-id={item.songId}>
      <div className="swipe-reveal remove" aria-hidden="true">{en.queue.swipeRemove}<Icon name="trash" /></div>
      <div className="queue-face" data-swipe-face>
        {orderable && <button type="button" className="grip" data-grip aria-label={en.queue.dragHandle} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"><Icon name="grip" /></button>}
        {song && <Cover songId={song.id} title={song.title} hasCover={song.has_cover} youtubeId={song.youtube_id} size="row" />}
        <div className="queue-text">
          <strong title={title}>{title}</strong>
          <small>{song?.artist}{phone && <> · <LevelLabel level={item.difficulty === "progressive" ? resolved : item.difficulty} progressive={item.difficulty === "progressive"} size={14} /></>}</small>
        </div>
        {!phone && (
          <div className="queue-level" data-pinned={item.difficulty !== "progressive"}>
            <Select<QueueLevel> chip value={item.difficulty} options={levelOptions(resolved)} ariaLabel={en.queue.difficultyFor(title)} onChange={onLevel} />
          </div>
        )}
        {!phone
          ? <button type="button" className="icon-btn" aria-label={en.queue.remove} title={en.queue.remove} onClick={onRemove}><Icon name="close" /></button>
          : <button type="button" className="kebab" aria-haspopup="menu" aria-label={en.songMenu.open(title)} onClick={() => setOpen(true)}><Icon name="more" /></button>}
      </div>
      {open && <QueueRowSheet title={title} item={item} resolved={resolved} onClose={() => setOpen(false)} onLevel={onLevel} onRemove={onRemove} onTop={onTop} />}
    </li>
  );
}

/** The touch row menu: Difficulty (a second sheet), Move to top, Remove. */
function QueueRowSheet({ title, item, resolved, onClose, onLevel, onRemove, onTop }: { title: string; item: QueueItem; resolved: Level; onClose: () => void; onLevel: (l: QueueLevel) => void; onRemove: () => void; onTop: () => void }) {
  const sheet = useRef<SheetApi>(null);
  const [sub, setSub] = useState(false);
  const done = () => sheet.current?.close();
  return (
    <Sheet ref={sheet} label={title} className="song-sheet" onClose={onClose}>
      <header className="sheet-head"><strong>{title}</strong></header>
      <div role="menu">
        {!sub ? (
          <>
            <button type="button" role="menuitem" className="mi" onClick={() => setSub(true)}><Icon name="tune" /><span>{en.queue.difficulty}</span><span className="mi-more"><LevelLabel level={item.difficulty === "progressive" ? resolved : item.difficulty} progressive={item.difficulty === "progressive"} size={14} /></span></button>
            <button type="button" role="menuitem" className="mi" onClick={() => { onTop(); done(); }}><Icon name="arrowUp" /><span>{en.queue.moveTop}</span></button>
            <hr />
            <button type="button" role="menuitem" className="mi danger" onClick={() => { onRemove(); done(); }}><Icon name="trash" /><span>{en.queue.remove}</span></button>
          </>
        ) : levelOptions(resolved).map((o) => (
          <button key={o.value} type="button" role="menuitemradio" aria-checked={item.difficulty === o.value} className="mi" onClick={() => { onLevel(o.value); done(); }}>
            <span className="mi-node">{o.node}</span>{item.difficulty === o.value && <Icon name="check" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
