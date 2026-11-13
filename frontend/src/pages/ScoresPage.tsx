import { useEffect, useMemo, useState } from "react";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { Marquee } from "../components/Marquee";
import { PlayButton } from "../components/PlayButton";
import { useAsync } from "../hooks/useAsync";
import { useLayout } from "../hooks/useLayout";
import { useThumb } from "../hooks/useThumb";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { isOneOf, usePref } from "../lib/prefs";
import { ordinal, scoresMatcher, boardHeading } from "../lib/scores-view";
import { paths } from "../router";
import { api } from "../services/api";
import type { GlobalScoreDto, MyScoreDto, SongScoreDto } from "../services/api";
import type { GameMode } from "../types/game";

const isSongPref = (v: unknown): v is "all" | number => v === "all" || (typeof v === "number" && Number.isInteger(v) && v > 0);

/** a phone on its side has the room for the list and the board together */
function useSideways(): boolean {
  const q = "(orientation: landscape) and (max-height: 500px)";
  const [on, setOn] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const l = window.matchMedia?.(q);
    if (!l) return;
    const f = () => setOn(l.matches);
    l.addEventListener("change", f);
    return () => l.removeEventListener("change", f);
  }, []);
  return on;
}

/**
 * The scores (guide section 21): the songs the player finished, with their best points and place; a row opens the song's board (top 10, and the
 * player's own row when below it). The first row is the overall board. On a phone the board is a page of its own (#/scores/<song|all>); wider
 * screens, and a phone on its side, show the list and the board side by side.
 */
export function ScoresPage({ song }: { song: number | "all" | null }) {
  const layout = useLayout();
  const sideways = useSideways();
  const split = layout !== "phone" || sideways;
  const modeThumb = useThumb();
  const [mode, setMode] = usePref<GameMode>("scores_mode", "choice", isOneOf("choice", "typing"));
  const [remembered, setRemembered] = usePref<"all" | number>("scores_song", "all", isSongPref);
  const [query, setQuery] = useState("");
  const mine = useAsync(() => api.myScores(mode), [mode]);
  const open = song ?? (split ? remembered : null);
  useEffect(() => { if (song !== null && song !== remembered) setRemembered(song); }, [song]); // eslint-disable-line react-hooks/exhaustive-deps

  const matcher = useMemo(() => scoresMatcher(query), [query]);
  const rows = useMemo(() => (mine.data?.songs ?? []).filter((r) => matcher(r.title, r.artist)), [mine.data, matcher]);
  const overall = mine.data?.overall ?? null;
  const nothing = !!mine.data && mine.data.songs.length === 0;

  const modeSwitch = (
    <div className="segmented tabs thumbs" role="group" aria-label={en.library.modeLabel} ref={modeThumb}>
      {(["choice", "typing"] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}><b>{en.library.modes[m].name}</b></button>
      ))}
    </div>
  );

  if (!split && open !== null) {
    return <div className="scores-page" data-split="false"><BoardPane open={open} mode={mode} mine={mine.data?.songs ?? []} modeSwitch={modeSwitch} /></div>;
  }

  const list = (
    <div className="scores-list">
      <label className="scores-search">
        <Icon name="search" />
        <input type="search" {...noAutofill("scores-search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.scores.findSong} aria-label={en.scores.findSong} />
        {query !== "" && <button type="button" className="clear-x" onClick={() => setQuery("")} aria-label={en.library.clear} title={en.library.clear}><Icon name="close" /></button>}
      </label>
      {!split && modeSwitch}
      {mine.error && <p className="notice error">{mine.error.message}</p>}
      {!mine.data && !mine.error && <SkeletonRows />}
      {nothing && <Empty />}
      {mine.data && !nothing && (
        <>
          {query === "" && overall && (
            <a className="scrow all" href={paths.scoresSong("all")} aria-current={open === "all" ? "true" : undefined} aria-label={en.scores.allRowLabel(overall.points, overall.rank, overall.players)}>
              <span className="cov all-tile"><Icon name="leaderboard" /></span>
              <span className="scrow-text"><strong className="st">{en.scores.all}</strong><span className="sa">{en.scores.total(overall.songs)}</span></span>
              <Mine points={overall.points} rank={overall.rank} players={overall.players} />
            </a>
          )}
          {query === "" && <div className="eyebrow scores-eyebrow">{en.scores.played}</div>}
          {rows.length === 0 ? (
            <div className="empty-card scores-empty">
              <strong>{en.scores.noMatch(query.trim())}</strong>
              <p className="muted">{en.scores.noMatchHelp}</p>
              <button type="button" className="btn secondary small" onClick={() => setQuery("")}>{en.scores.clearSearch}</button>
            </div>
          ) : rows.map((r) => <SongRow key={r.song_id} r={r} current={open === r.song_id} />)}
        </>
      )}
    </div>
  );

  if (!split) {
    return <div className="scores-page" data-split="false">{list}</div>;
  }
  return (
    <div className="scores-page" data-split="true">
      {!sideways && (
        <div className="scores-head">
          <div className="page-head">
            <div>
              <h1>{en.scores.title}</h1>
              <div className="count">{en.scores.help}</div>
            </div>
          </div>
          {modeSwitch}
        </div>
      )}
      {sideways && <h1 className="sr-only">{en.scores.title}</h1>}
      <div className="scores-left">{list}</div>
      <div className="scores-right">{open !== null && !nothing && <BoardPane open={open} mode={mode} mine={mine.data?.songs ?? []} modeSwitch={sideways ? modeSwitch : null} />}</div>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty-card scores-empty">
      <strong>{en.scores.emptyTitle}</strong>
      <p className="muted">{en.scores.empty}</p>
      <a className="btn" href={paths.library()}>{en.scores.toLibrary}</a>
    </div>
  );
}

function SkeletonRows() {
  return <div className="scores-skeleton" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="scrow sk"><span className="cov" /><span className="scrow-text"><i /><i /></span></div>)}</div>;
}

/** Your best points on the right of a row, and under them your place as a badge with "of N". */
function Mine({ points, rank, players }: { points: number; rank: number; players: number }) {
  return (
    <span className="mine">
      <b>{points.toLocaleString("en")}<small>{en.scores.pts}</small></b>
      <span className="place"><span className="pb" data-place={rank <= 3 ? rank : undefined}>{rank}</span>{en.scores.ofPlayers(players)}</span>
    </span>
  );
}

function SongRow({ r, current }: { r: MyScoreDto; current: boolean }) {
  return (
    <a className="scrow" href={paths.scoresSong(r.song_id)} aria-current={current ? "true" : undefined} aria-label={en.scores.rowLabel(r.title, r.points, ordinal(r.rank), r.players)}>
      <Cover songId={r.song_id} title={r.title} hasCover={r.has_cover} youtubeId={r.youtube_id} size="row" />
      <span className="scrow-text">
        <strong className="st">{r.title}</strong>
        <span className="sa">{r.artist}</span>
        {r.removed && <span className="tag">{en.scores.removed}</span>}
      </span>
      <Mine points={r.points} rank={r.rank} players={r.players} />
    </a>
  );
}

function BoardPane({ open, mode, mine, modeSwitch }: { open: "all" | number; mode: GameMode; mine: MyScoreDto[]; modeSwitch: React.ReactNode }) {
  return (
    <section className="board-pane" aria-label={en.scores.title}>
      {modeSwitch}
      {open === "all" ? <AllBoard mode={mode} /> : <SongBoard songId={open} mode={mode} mine={mine} key={`${open}-${mode}`} />}
    </section>
  );
}

function PaneHead({ cover, title, sub, play }: { cover: React.ReactNode; title: React.ReactNode; sub: string; play?: React.ReactNode }) {
  return (
    <div className="pane-head">
      {cover}
      <div className="pane-title"><h2>{title}</h2><div className="sa">{sub}</div></div>
      {play}
    </div>
  );
}

function AllBoard({ mode }: { mode: GameMode }) {
  const board = useAsync(() => api.scoreBoard(mode, 10), [mode]);
  return (
    <>
      <PaneHead cover={<span className="cov all-tile"><Icon name="leaderboard" /></span>} title={en.scores.all} sub={en.scores.allHelp} />
      {board.error && <p className="notice error">{board.error.message}</p>}
      {!board.data && !board.error && <p className="muted">…</p>}
      {board.data && (
        <Board
          heading={boardHeading(board.data.players, board.data.rows.length, !!(board.data.me || board.data.rows.some((r) => r.me)))}
          you={(board.data.me ?? board.data.rows.find((r) => r.me)) ? youLine((board.data.me ?? board.data.rows.find((r) => r.me))!.points, (board.data.me ?? board.data.rows.find((r) => r.me))!.rank, board.data.players) : null}
          rows={board.data.rows.map(globalRow)}
          me={board.data.me ? globalRow(board.data.me) : null}
        />
      )}
    </>
  );
}

const youLine = (points: number, rank: number, players: number) => en.scores.youLine(points.toLocaleString("en"), ordinal(rank), players);
const globalRow = (r: GlobalScoreDto): BoardRow => ({ rank: r.rank, name: r.display_name, detail: en.scores.songs(r.songs), points: r.points, me: r.me });
const songRow = (r: SongScoreDto): BoardRow => ({ rank: r.rank, name: r.display_name, points: r.points, me: r.me, detail: en.scores.detail(en.library.difficulty[r.difficulty] ?? r.difficulty, r.correct, r.total, r.best_multiplier) });

function SongBoard({ songId, mode, mine }: { songId: number; mode: GameMode; mine: MyScoreDto[] }) {
  const board = useAsync(() => api.songBoard(songId, mode, 10), [songId, mode]);
  const row = mine.find((r) => r.song_id === songId);
  const songs = useAsync(() => (row ? Promise.resolve([]) : api.songs()), [row?.song_id]);
  const info = row ? { title: row.title, artist: row.artist, hasCover: row.has_cover, youtubeId: row.youtube_id, removed: row.removed } : (() => { const s = songs.data?.find((x) => x.id === songId); return s ? { title: s.title, artist: s.artist, hasCover: s.has_cover, youtubeId: s.youtube_id, removed: false } : null; })();
  const youRow = board.data ? board.data.me ?? board.data.rows.find((r) => r.me) ?? null : null;
  const canPlay = !!info && !info.removed;
  return (
    <>
      {info ? (
        <PaneHead
          cover={<Cover songId={songId} title={info.title} hasCover={info.hasCover} youtubeId={info.youtubeId} size="large" />}
          title={<Marquee>{info.title}</Marquee>}
          sub={info.artist}
          play={canPlay ? <PlayButton onClick={() => { location.hash = paths.song(songId); }} aria-label={`${en.library.play} ${info.title}`} title={en.library.play} /> : undefined}
        />
      ) : <div className="pane-head" />}
      {board.error && <p className="notice error">{board.error.message}</p>}
      {!board.data && !board.error && <p className="muted">…</p>}
      {board.data && board.data.rows.length === 0 && (
        <div className="empty-card scores-empty">
          <strong>{en.scores.noGame(en.library.modes[mode].name)}</strong>
          <p className="muted">{en.scores.noGameHelp(en.library.modes[mode].name)}</p>
        </div>
      )}
      {board.data && board.data.rows.length > 0 && (
        <Board
          heading={boardHeading(board.data.players, board.data.rows.length, !!youRow)}
          you={youRow ? youLine(youRow.points, youRow.rank, board.data.players) : null}
          rows={board.data.rows.map(songRow)}
          me={board.data.me ? songRow(board.data.me) : null}
        />
      )}
    </>
  );
}

interface BoardRow { rank: number; name: string; detail: string; points: number; me: boolean }

/** The top of a board; when the player is below it, three dots (a gap) and their own row with their real rank. */
export function Board({ heading, you, rows, me }: { heading: string; you: string | null; rows: BoardRow[]; me: BoardRow | null }) {
  const row = (r: BoardRow) => (
    <li key={r.rank} data-me={r.me}>
      <span className="rank" data-place={r.rank <= 3 ? r.rank : undefined}>{r.rank}</span>
      <span className="who">
        <strong>{r.name}</strong>{r.me && <span className="tag you">{en.scores.you}</span>}
        <small>{r.detail}</small>
      </span>
      <span className="pts">{r.points.toLocaleString("en")}<small>{en.scores.pts}</small></span>
    </li>
  );
  return (
    <>
      <div className="board-heading"><span className="eyebrow">{heading}</span>{you && <span className="you-line">{you}</span>}</div>
      <ol className="board" aria-label={en.scores.title}>
        {rows.map(row)}
        {me && <li className="gap" aria-hidden="true"><i /><i /><i /></li>}
        {me && row(me)}
      </ol>
    </>
  );
}
