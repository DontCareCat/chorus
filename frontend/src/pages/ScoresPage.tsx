import { useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { api } from "../services/api";
import type { GlobalScoreDto, SongScoreDto } from "../services/api";

/** The two scoreboards: everybody's total over all songs, and the best games on one song. */
export function ScoresPage() {
  const [tab, setTab] = useState<"all" | "song">("all");
  const songs = useAsync(() => api.songs(), []);
  const [songId, setSongId] = useState<number | null>(null);
  const chosen = songId ?? songs.data?.[0]?.id ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{en.scores.title}</h1>
          <div className="count">{en.scores.help}</div>
        </div>
      </div>
      <div className="segmented tabs" role="group" aria-label={en.scores.title}>
        {(["all", "song"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}><b>{en.scores[t]}</b></button>
        ))}
      </div>
      {tab === "all" ? <GlobalBoard /> : (
        <>
          <label className="field" style={{ marginTop: 14 }}>
            <span>{en.scores.chooseSong}</span>
            <select value={chosen ?? ""} onChange={(e) => setSongId(Number(e.target.value))}>
              {(songs.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.title} · {s.artist}</option>)}
            </select>
          </label>
          {chosen !== null && <SongBoard songId={chosen} key={chosen} />}
        </>
      )}
    </>
  );
}

function Empty() {
  return <p className="empty">{en.scores.empty}</p>;
}

function GlobalBoard() {
  const rows = useAsync(() => api.scores(), []);
  if (rows.error) return <p className="notice error">{rows.error.message}</p>;
  if (!rows.data) return <p className="muted">…</p>;
  if (rows.data.length === 0) return <Empty />;
  return <Board rows={rows.data.map((r: GlobalScoreDto) => ({ rank: r.rank, name: r.display_name, detail: en.scores.songs(r.songs), points: r.points, me: r.me }))} />;
}

function SongBoard({ songId }: { songId: number }) {
  const rows = useAsync(() => api.songScores(songId), [songId]);
  if (rows.error) return <p className="notice error">{rows.error.message}</p>;
  if (!rows.data) return <p className="muted">…</p>;
  if (rows.data.length === 0) return <Empty />;
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
          <span className="rank">{r.rank}</span>
          <span className="who">
            <strong>{r.name}</strong>{r.me && <span className="tag">{en.scores.you}</span>}
            <small>{r.detail}</small>
          </span>
          <span className="pts">{r.points}</span>
        </li>
      ))}
    </ol>
  );
}
