import { useThumb } from "../hooks/useThumb";
import { Cover } from "../components/Cover";
import { Select } from "../components/Select";
import { isId, isOneOf, usePref } from "../lib/prefs";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api } from "../services/api";
import type { GlobalScoreDto, SongScoreDto } from "../services/api";
import type { GameMode } from "../types/game";

/** The two scoreboards: everybody's total over all songs, and the best games on one song. */
export function ScoresPage() {
  const tabThumb = useThumb();
  const modeThumb = useThumb();
  const [tab, setTab] = usePref<"all" | "song">("scores_tab", "all", isOneOf("all", "song"));
  const [mode, setMode] = usePref<GameMode>("scores_mode", "choice", isOneOf("choice", "typing"));
  const songs = useAsync(() => api.songs(), []);
  const [songId, setSongId] = usePref<number | null>("scores_song", null, isId);
  const chosen = songs.data?.some((s) => s.id === songId) ? songId : songs.data?.[0]?.id ?? null; // (a remembered song that is gone falls back to the first)

  const chosenSong = songs.data?.find((s) => s.id === chosen);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{en.scores.title}</h1>
          <div className="count">{en.scores.help}</div>
        </div>
      </div>
      <div className="scores-toolbar">
        <div className="segmented tabs thumbs" role="group" aria-label={en.scores.title} ref={tabThumb}>
          {(["all", "song"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}><b>{en.scores[t]}</b></button>
          ))}
        </div>
        <div className="segmented tabs thumbs" role="group" aria-label={en.library.modeLabel} ref={modeThumb}>
          {(["choice", "typing"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}><b>{en.library.modes[m].name}</b></button>
          ))}
        </div>
      </div>
      {tab === "all" ? <GlobalBoard mode={mode} /> : (
        <>
          <div className="song-pick">
            {chosenSong && <Cover songId={chosenSong.id} title={chosenSong.title} hasCover={chosenSong.has_cover} youtubeId={chosenSong.youtube_id} size="large" />}
            <label className="field">
              <span>{en.scores.chooseSong}</span>
              <Select value={chosen ?? ""} onChange={(v: number) => setSongId(v)} options={(songs.data ?? []).map((s) => ({ value: s.id, label: `${s.title} · ${s.artist}` }))} />
            </label>
          </div>
          {songs.data && songs.data.length === 0 && <Empty />}
          {chosen !== null && <SongBoard songId={chosen} mode={mode} key={`${chosen}-${mode}`} />}
        </>
      )}
    </>
  );
}

function Empty({ song = false }: { song?: boolean }) {
  return (
    <div className="empty-card scores-empty">
      <strong>{song ? en.scores.emptySongTitle : en.scores.emptyTitle}</strong>
      <p className="muted">{song ? en.scores.emptySong : en.scores.empty}</p>
      <a className="btn" href={paths.library()}>{en.scores.toLibrary}</a>
    </div>
  );
}

function GlobalBoard({ mode }: { mode: GameMode }) {
  const rows = useAsync(() => api.scores(mode), [mode]);
  if (rows.error) return <p className="notice error">{rows.error.message}</p>;
  if (!rows.data) return <p className="muted">…</p>;
  if (rows.data.length === 0) return <Empty />;
  return <Board rows={rows.data.map((r: GlobalScoreDto) => ({ rank: r.rank, name: r.display_name, detail: en.scores.songs(r.songs), points: r.points, me: r.me }))} />;
}

function SongBoard({ songId, mode }: { songId: number; mode: GameMode }) {
  const rows = useAsync(() => api.songScores(songId, mode), [songId, mode]);
  if (rows.error) return <p className="notice error">{rows.error.message}</p>;
  if (!rows.data) return <p className="muted">…</p>;
  if (rows.data.length === 0) return <Empty song />;
  return (
    <Board
      rows={rows.data.map((r: SongScoreDto) => ({
        rank: r.rank, name: r.display_name, points: r.points, me: r.me,
        detail: en.scores.detail(en.library.difficulty[r.difficulty] ?? r.difficulty, r.correct, r.total, r.best_multiplier),
      }))}
    />
  );
}

interface Row { rank: number; name: string; detail: string; points: number; me: boolean }

export function Board({ rows }: { rows: Row[] }) {
  return (
    <ol className="board" aria-label={en.scores.title}>
      {rows.map((r) => (
        <li key={r.rank} data-me={r.me}>
          <span className="rank" data-place={r.rank <= 3 ? r.rank : undefined}>{r.rank}</span>
          <span className="who">
            <strong>{r.name}</strong>{r.me && <span className="tag">{en.scores.you}</span>}
            <small>{r.detail}</small>
          </span>
          <span className="pts">{r.points.toLocaleString("en")}<small>{en.scores.pts}</small></span>
        </li>
      ))}
    </ol>
  );
}
