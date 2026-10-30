import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "./Cover";
import { CoverPicker } from "./CoverPicker";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { SongMenu } from "./SongMenu";
import type { MenuExtra, SongAction } from "./SongMenu";
import { Details, Finder } from "./SongTools";
import { StatusBadge } from "./StatusBadge";
import { useAsync } from "../hooks/useAsync";
import { useLongPress } from "../hooks/useLongPress";
import type { useSelection } from "../hooks/useSelection";
import { useQueueActions } from "../hooks/useQueueActions";
import { useReorder } from "../hooks/useReorder";
import { PlayButton } from "./PlayButton";
import { useSwipe } from "../hooks/useSwipe";
import { useThumb } from "../hooks/useThumb";
import type { DuplicateReason } from "../lib/duplicates";
import { songStatus } from "../lib/lyrics-status";
import { sortValue } from "../lib/library-sort";
import type { SortChoice } from "../lib/library-sort";
import { scrollTarget } from "../lib/scroll-into-view";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { GameSummaryDto, SongDto, SongScoreDto } from "../services/api";
import type { GameMode } from "../types/game";

const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
const PERCENT: Record<GameMode, Record<string, number>> = {
  choice: { easy: 10, medium: 30, hard: 60, expert: 80 },
  typing: { easy: 10, medium: 25, hard: 40, expert: 60 }, // typing a word takes longer: fewer words per level
};
const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

interface SongListProps {
  songs: SongDto[];
  games: GameSummaryDto[];
  phone: boolean;
  /** the key the list is sorted by: its value ends each row's meta line (null: nothing) */
  sortKey: SortChoice["key"] | null;
  /** changes when the list is a different one (filter, sort): the rows fade in again */
  listKey: string;
  selection?: ReturnType<typeof useSelection>;
  duplicate?: (s: SongDto) => { reasons: DuplicateReason[]; copyOf?: string } | undefined;
  reload: () => void;
  /** take the song out of the library (the menu's Remove, or the fix of a missing file) */
  onRemove: (s: SongDto) => void;
  /** more menu items (add to playlist ...) and what they do */
  extras?: (s: SongDto) => MenuExtra[];
  onExtra?: (id: string, s: SongDto) => void;
  /** songs shown greyed and not playable (removed from the library but kept in a playlist) */
  removed?: (s: SongDto) => boolean;
  /** the list is ordered by hand: a grip to drag on a PC, hold-and-drag on touch screens */
  reorder?: { onReorder: (ids: number[]) => void };
}

/** The rows of the library or of a playlist, with the ⋮ menu, the tool dialogs and the play options of one open song. */
export function SongList({ songs, games, phone, sortKey, listKey, selection, duplicate, reload, onRemove, extras, onExtra, removed, reorder }: SongListProps) {
  const ul = useRef<HTMLUListElement>(null);
  const queue = useQueueActions();
  const moved = useReorder(ul, { ids: songs.map((s) => s.id), enabled: !!reorder, mode: phone ? "press" : "grip", onReorder: (ids) => reorder?.onReorder(ids) });
  const [open, setOpen] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; anchor: HTMLElement } | null>(null);
  const [tool, setTool] = useState<{ kind: "lyrics" | "cover" | "language" | "metadata"; id: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeTool = useCallback(() => setTool(null), []);
  // phones: opening a song's play options brings them into view (the whole panel when it fits, else the top of the row first)
  useEffect(() => {
    if (!phone || open === null) return;
    const bring = () => {
      const li = document.querySelector<HTMLElement>(`li.song[data-song-id="${open}"]`);
      const main = li?.querySelector(".song-main");
      const panel = li?.querySelector(".start-panel");
      if (!main || !panel) return;
      const vv = window.visualViewport;
      const bar = document.querySelector(".select-bar")?.getBoundingClientRect();
      const dy = scrollTarget({
        itemTop: main.getBoundingClientRect().top, panelBottom: panel.getBoundingClientRect().bottom,
        viewTop: Math.max(vv?.offsetTop ?? 0, bar ? bar.bottom : 0), viewBottom: (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight),
      });
      if (dy !== 0) window.scrollBy({ top: dy, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    const first = requestAnimationFrame(bring);
    const later = setTimeout(bring, 350); // the history and scores arrive after the panel opens and change its height
    return () => { cancelAnimationFrame(first); clearTimeout(later); };
  }, [phone, open]);

  // The rows are memoised, so what they are given must not change from one render to the next unless the row itself changed:
  // the handlers go through a ref, and every song's games come from one map.
  const act = useRef({ queue, setOpen, setMenu, setTool, onRemove, selection });
  act.current = { queue, setOpen, setMenu, setTool, onRemove, selection };
  const handlers = useMemo<RowHandlers>(() => ({
    queue: (s) => void act.current.queue.add([s.id]),
    pick: (s) => act.current.selection?.toggle(s.id),
    longPress: (s) => act.current.selection?.add(s.id),
    toggle: (s) => act.current.setOpen((o) => (o === s.id ? null : s.id)),
    menu: (s, anchor) => act.current.setMenu((m) => (m?.id === s.id ? null : { id: s.id, anchor })),
    fix: (s) => { const st = songStatus(s); if (st.fix === "lyrics") act.current.setTool({ kind: "lyrics", id: s.id }); else if (st.fix === "file") act.current.onRemove(s); },
  }), []);
  const gamesBySong = useMemo(() => {
    const m = new Map<number, GameSummaryDto[]>();
    for (const g of games) (m.get(g.song_id) ?? m.set(g.song_id, []).get(g.song_id)!).push(g);
    return m;
  }, [games]);
  const selecting = selection?.active ?? false;
  // A long list draws only the rows near the screen, with an empty gap of the right height for the others: a few thousand rows in the
  // page made every call to the phone's database (each one comes back as a script run in the page) wait for the page to lay out again.
  const windowed = !reorder && songs.length > WINDOW_FROM;
  const heights = useRef(new Map<number, number>());
  const estimate = useRef(phone ? 112 : 120);
  const [range, setRange] = useState({ from: 0, to: 40 });
  const [measured, setMeasured] = useState(0);
  const cumulative = useMemo(() => {
    const out = new Array<number>(songs.length + 1);
    out[0] = 0;
    for (let i = 0; i < songs.length; i++) out[i + 1] = out[i]! + (heights.current.get(songs[i]!.id) ?? estimate.current);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, measured]);
  const place = useCallback(() => {
    const el = ul.current;
    if (!windowed || !el) return;
    const top = el.getBoundingClientRect().top; // where the list starts, relative to the screen
    const from = firstBelow(cumulative, -top - WINDOW_MARGIN);
    const to = firstBelow(cumulative, -top + window.innerHeight + WINDOW_MARGIN);
    setRange((r) => (r.from === from && r.to === to ? r : { from, to }));
  }, [windowed, cumulative]);
  useEffect(() => {
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place); window.removeEventListener("resize", place); };
  }, [place]);
  // remember the real height of every row that is drawn (the gaps are made of them)
  useEffect(() => {
    if (!windowed || !ul.current) return;
    let changed = false;
    for (const li of ul.current.querySelectorAll<HTMLElement>("li.song")) {
      const id = Number(li.dataset.songId), h = li.offsetHeight;
      if (h > 0 && Math.abs((heights.current.get(id) ?? 0) - h) > 1) { heights.current.set(id, h); changed = true; }
    }
    if (changed) setMeasured((n) => n + 1);
  });
  const forced = useMemo(() => new Set(songs.flatMap((s, i) => (s.id === open || s.id === menu?.id ? [i] : []))), [songs, open, menu?.id]);

  return (
    <>
      <ul className="songs" key={listKey} ref={ul} data-selecting={selecting} data-orderable={!!reorder}>
        {(() => {
          const out: React.ReactNode[] = [];
          let gapFrom = -1;
          const closeGap = (end: number) => {
            if (gapFrom >= 0) out.push(<li key={`gap-${gapFrom}`} className="songs-gap" aria-hidden="true" style={{ height: cumulative[end]! - cumulative[gapFrom]! }} />);
            gapFrom = -1;
          };
          songs.forEach((s, i) => {
            if (windowed && (i < range.from || i > range.to) && !forced.has(i)) {
              if (gapFrom < 0) gapFrom = i;
              return;
            }
            closeGap(i);
            const dup = duplicate?.(s);
            out.push(
              <SongRow
                key={s.id} song={s} phone={phone} sortKey={sortKey} selectionActive={selecting} picked={selection?.has(s.id) ?? false}
                handlers={handlers} selectable={!!selection} orderable={!!reorder && !phone} reorderRow={!!reorder}
                copyOf={dup?.copyOf} duplicate={dup?.reasons} gone={removed?.(s) ?? false}
                open={open === s.id} games={gamesBySong.get(s.id) ?? NO_GAMES} menuOpen={menu?.id === s.id}
              />,
            );
          });
          closeGap(songs.length);
          return out;
        })()}
      </ul>
      <div className="sr-only" role="status" aria-live="polite">{moved}</div>
      {menu && (() => {
        const s = songs.find((x) => x.id === menu.id);
        return s ? (
          <SongMenu
            song={s} status={songStatus(s)} phone={phone} anchor={menu.anchor} onClose={closeMenu} extras={[{ id: "queue", icon: "queue", label: en.queue.addTo }, ...(extras?.(s) ?? [])]}
            onExtra={(id) => { if (id === "queue") void queue.add([s.id]); else onExtra?.(id, s); }}
            onPick={(a: SongAction) => { if (a === "remove") onRemove(s); else setTool({ kind: a, id: s.id }); }}
          />
        ) : null;
      })()}
      {tool && (() => {
        const s = songs.find((x) => x.id === tool.id);
        if (!s) return null;
        return (
          <Dialog title={en.songMenu.titles[tool.kind] ?? ""} subtitle={`${s.title} · ${s.artist}`} onClose={closeTool}>
            {tool.kind === "lyrics" && <Finder bare song={s} hasLyrics={s.lyrics_status === "found"} onAttached={reload} />}
            {tool.kind === "cover" && <CoverPicker bare song={s} onChanged={reload} />}
            {tool.kind === "language" && <Details bare part="language" song={s} onSaved={reload} />}
            {tool.kind === "metadata" && <Details bare part="metadata" song={s} onSaved={reload} />}
          </Dialog>
        );
      })()}
    </>
  );
}

const NO_GAMES: GameSummaryDto[] = [];
/** Lists longer than this draw only the rows near the screen. */
const WINDOW_FROM = 80;
/** How far above and below the screen rows are drawn (a quick scroll meets rows that are already there). */
const WINDOW_MARGIN = 1200;

/** The index of the row that contains `y` (offsets from the top of the list), within the list. */
function firstBelow(cumulative: number[], y: number): number {
  let lo = 0, hi = cumulative.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid]! <= y) lo = mid; else hi = mid - 1;
  }
  return Math.max(0, lo);
}

interface RowHandlers {
  queue: (s: SongDto) => void;
  pick: (s: SongDto) => void;
  longPress: (s: SongDto) => void;
  toggle: (s: SongDto) => void;
  menu: (s: SongDto, anchor: HTMLElement) => void;
  fix: (s: SongDto) => void;
}

interface RowProps {
  song: SongDto;
  sortKey: SortChoice["key"] | null;
  handlers: RowHandlers;
  selectable: boolean;
  orderable: boolean;
  reorderRow: boolean;
  gone: boolean;
  phone: boolean;
  selectionActive: boolean;
  picked: boolean;
  duplicate?: DuplicateReason[];
  copyOf?: string;
  open: boolean;
  games: GameSummaryDto[];
  menuOpen: boolean;
}

const SongRow = memo(function SongRow({ song: s, sortKey, handlers, selectable, orderable, reorderRow, gone, phone, selectionActive, picked, duplicate, copyOf, open, games, menuOpen }: RowProps) {
  const ready = s.lyrics_status === "found" && s.available && !gone;
  const status = songStatus(s);
  const onPick = () => handlers.pick(s);
  const onToggle = () => handlers.toggle(s);
  const press = useLongPress({ onLongPress: () => handlers.longPress(s) });
  const li = useRef<HTMLLIElement>(null);
  useSwipe(li, { directions: ["right"], onSwipe: () => handlers.queue(s), enabled: phone && ready });
  const dots = useRef<HTMLButtonElement>(null);
  const rowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, label")) return;
    if (press.consumeClick()) return;
    if (selectable && selectionActive) onPick();
    else if (phone && ready) onToggle(); // phones have no play button: a tap opens the play options
  };
  return (
    <li className="song" ref={li} data-song-id={s.id} data-reorder-id={reorderRow ? s.id : undefined} data-gone={gone || undefined}>
      <>
          <div className="swipe-reveal add" aria-hidden="true"><Icon name="queue" />{en.queue.swipeAdd}</div>
          <div className="song-main" data-swipe-face data-picked={picked} data-open={open} data-selecting={selectionActive} onClick={rowClick} {...(phone && selectable ? press.handlers : {})}>
            {selectable ? <input type="checkbox" className="pick" checked={picked} onChange={onPick} aria-label={en.library.pick(s.title)} /> : orderable ? <button type="button" className="grip" data-grip aria-label={en.playlists.dragHandle} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title={en.playlists.dragHandle}><Icon name="grip" /></button> : <span className="pick-gap" aria-hidden="true" />}
            <Cover songId={s.id} title={s.title} hasCover={s.has_cover} youtubeId={s.youtube_id} size="row" />
            <div className="song-text">
              <div className="song-title" title={s.title}>{s.title}{gone && <span className="dup-tag">{en.playlists.removedTag}</span>}</div>
              <div className="song-meta">
                <span title={s.artist}>{s.artist}</span>
                <span className="lang">{s.language}</span>
                {s.source === "youtube" && <span className="dup-tag yt-tag">{en.library.youtubeBadge}</span>}
                {s.source === "youtube" && /- topic$/i.test(s.youtube_channel ?? "") && <span className="dup-tag" title={en.library.albumTimingHelp}>{en.library.albumTiming}</span>}
                {(s.duration > 0 || s.source !== "youtube") && <span>{mmss(s.duration)}</span>}
                {sortKey && sortKey !== "name" && <SortedBy sortKey={sortKey} song={s} />}
                {duplicate && <span className="dup-tag" title={duplicate.map((r) => en.library.duplicateReason[r]).join(" · ")}>{copyOf ? en.library.copyOf(copyOf) : en.library.duplicateHint}</span>}
              </div>
            </div>
            <div className="status-cell"><StatusBadge status={status} phone={phone} onFix={() => handlers.fix(s)} /></div>
            {!phone && <PlayButton className="play-btn" onClick={onToggle} disabled={!ready} aria-expanded={open} aria-label={`${en.library.play} ${s.title}`} title={ready ? en.library.play : en.library.needsLyrics} />}
            <button type="button" ref={dots} className="kebab" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={en.songMenu.open(s.title)} onClick={() => dots.current && handlers.menu(s, dots.current)}><Icon name="more" /></button>
          </div>
          {open && <div className="expand"><StartPanel song={s} games={games} /></div>}
      </>
    </li>
  );
});

function StartPanel({ song, games }: { song: SongDto; games: GameSummaryDto[] }) {
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<GameMode>("choice");
  const modeThumb = useThumb();
  const levelThumb = useThumb();
  const board = useAsync(() => api.songScores(song.id, mode), [song.id, mode]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGame(song.id, difficulty, mode);
      location.hash = paths.game(g.public_id);
    } catch (e) {
      setError(msg(e));
      setBusy(false);
    }
  };

  return (
    <div className="start-panel">
      <div>
        <div className="label">{en.library.modeLabel}</div>
        <div className="segmented mode-switch thumbs" role="group" aria-label={en.library.modeLabel} ref={modeThumb}>
          {(["choice", "typing"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              <b>{en.library.modes[m].name}</b>
              <small>{en.library.modes[m].help}</small>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="label">{en.library.difficultyLabel}</div>
        <div className="segmented thumbs" role="group" aria-label={en.library.difficultyLabel} ref={levelThumb}>
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
              <b>{en.library.difficulty[d]}</b>
              <small>{PERCENT[mode][d]}% of words</small>
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="btn large" onClick={() => void start()} disabled={busy}>{en.library.startGame}</button>
      <div className="history">
        <History games={games.filter((g) => g.mode === mode)} board={board.data ?? []} />
        {error && <p className="notice error">{error}</p>}
      </div>
    </div>
  );
}

function History({ games, board }: { games: GameSummaryDto[]; board: SongScoreDto[] }) {
  const mine = board.find((r) => r.me);
  const top = (
    <>
      {mine && <div>{en.scores.rank(mine.rank, board.length)}</div>}
      {board.length > 0 && (
        <ol className="mini-board" aria-label={en.scores.top}>
          {board.slice(0, 3).map((r) => <li key={r.rank} data-me={r.me}><span>{r.rank}.</span><span>{r.display_name}</span><span>{r.points}</span></li>)}
        </ol>
      )}
    </>
  );
  if (games.length === 0) return <>{en.library.history.none}{top}</>;
  const diff = (g: GameSummaryDto) => en.library.difficulty[g.difficulty] ?? g.difficulty;
  const open = games.find((g) => !g.finished_at);
  const last = games.find((g) => g.finished_at);
  const best = Math.max(...games.map((g) => g.score));
  return (
    <>
      {open && <div><a href={paths.game(open.public_id)}>{en.library.history.inProgress(diff(open), open.answered, open.total)}</a></div>}
      {last && <div>{en.library.history.last(diff(last), last.score, last.correct_count, last.total)}</div>}
      <div>{en.library.history.best(best)}</div>
      {top}
    </>
  );
}

/** The value the list is sorted by, at the end of the meta line (empty values say "never played"). */
function SortedBy({ sortKey, song }: { sortKey: SortChoice["key"]; song: SongDto }) {
  const v = sortValue(sortKey, song);
  const text = v === null ? en.library.sort.never : en.library.sort[v.kind](v.value as never);
  return <span className="sorted-by" data-empty={v === null}>{text}</span>;
}
