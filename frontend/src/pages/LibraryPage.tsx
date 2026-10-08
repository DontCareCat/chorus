import { useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { GameSummaryDto, SongDto, SongScoreDto } from "../services/api";

const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
const PERCENT: Record<string, number> = { easy: 10, medium: 30, hard: 60, expert: 80 };
const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
const AUDIO_RE = /\.(mp3|m4a|flac|ogg|opus|wav)$/i;
type Filter = "all" | "ready" | "missing";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function LibraryPage() {
  const songs = useAsync(() => api.songs(), []);
  const games = useAsync(() => api.myGames(), []);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [path, setPath] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [copyFiles, setCopyFiles] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", ""); // not part of React's input typings
  }, [addOpen]);

  const run = async (job: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ kind: "ok", text: await job() });
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    } finally {
      setBusy(false);
      songs.reload();
    }
  };

  const scan = () =>
    run(async () => {
      const settings = await api.settings();
      if (settings.library_dirs.length === 0) throw new ApiError("no_folders", en.library.noFolders, 0);
      const r = await api.scan();
      if (r.errors.length) throw new ApiError("scan", `${en.library.scanDone(r.added, r.skipped, r.unavailable)}. ${r.errors.join(" ")}`, 0);
      return en.library.scanDone(r.added, r.skipped, r.unavailable);
    });

  const importPath = () =>
    run(async () => {
      const r = await api.importPath(path.trim(), recursive, copyFiles);
      setPath("");
      if (r.errors.length) throw new ApiError("import", `${en.library.importDone(r.added, r.skipped)}. ${r.errors.join(" ")}`, 0);
      return en.library.importDone(r.added, r.skipped);
    });

  const upload = (files: FileList | File[] | null) =>
    run(async () => {
      const list = Array.from(files ?? []).filter((f) => AUDIO_RE.test(f.name)); // a folder pick also contains art, text, …
      let added = 0;
      const problems: string[] = [];
      for (const [i, f] of list.entries()) {
        setNotice({ kind: "ok", text: en.library.uploading(i + 1, list.length) });
        try {
          await api.uploadSong(f);
          added++;
        } catch (e) {
          const why = msg(e);
          problems.push(why.includes(f.name) ? why : `${f.name}: ${why}`); // say WHY a file was skipped (without repeating the name)
        }
      }
      for (const ref of [fileRef, folderRef]) if (ref.current) ref.current.value = "";
      const shown = problems.slice(0, 3).join(" ") + (problems.length > 3 ? ` (+${problems.length - 3} more)` : "");
      if (added === 0 && problems.length > 0) throw new ApiError("upload_failed", shown, 0);
      return problems.length ? `${en.library.uploaded(added, problems.length)}. ${shown}` : en.library.uploaded(added, 0);
    });

  const remove = async (s: SongDto) => {
    const sure = window.confirm(s.source === "library" ? en.library.removeLibrary(s.title) : en.library.removeCopy(s.title));
    if (!sure) return;
    await run(async () => {
      await api.deleteSong(s.id);
      return en.library.removed(s.title);
    });
  };

  const all = songs.data ?? [];
  const isReady = (s: SongDto) => s.lyrics_status === "found" && s.available;
  const counts = { all: all.length, ready: all.filter(isReady).length, missing: all.filter((s) => !isReady(s)).length };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((s) => (filter === "all" || (filter === "ready") === isReady(s)) && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)));
  }, [all, filter, query]);

  const unfinished = (games.data ?? []).find((g) => !g.finished_at);
  const resumeSong = unfinished ? all.find((s) => s.id === unfinished.song_id) : undefined;

  return (
    <>
      <section className="page-head">
        <div>
          <h1>{en.library.title}</h1>
          <div className="count">{en.library.count(all.length)}</div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn secondary scan-top" onClick={scan} disabled={busy}>{busy ? en.library.scanning : en.library.scan}</button>
          <button type="button" className="btn" onClick={() => setAddOpen((v) => !v)} aria-expanded={addOpen}>
            <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>{addOpen ? "×" : "+"}</span>
            {en.library.addMusic}
          </button>
        </div>
      </section>

      {addOpen && (
        <section className="add-panel" aria-label={en.library.addMusic}>
          <div>
            <div
              className="dropzone"
              data-over={over}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}
            >
              <strong>{en.library.dropTitle}</strong>
              <span>{en.library.dropHelp}</span>
            </div>
            <div className="page-actions">
              <label className="btn secondary small">
                {en.library.upload}
                <input ref={fileRef} type="file" accept=".mp3,.m4a,.flac,.ogg,.opus,.wav,audio/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
              </label>
              <label className="btn secondary small">
                {en.library.uploadFolder}
                <input ref={folderRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
              </label>
              <button type="button" className="btn secondary small scan-in" onClick={scan} disabled={busy}>{busy ? en.library.scanning : en.library.scan}</button>
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (path.trim()) void importPath(); }}>
            <div>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>{en.library.importPath}</span>
                <div className="inline" style={{ alignItems: "stretch", flexWrap: "nowrap" }}>
                  <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder={en.library.importPlaceholder} style={{ fontSize: 15 }} />
                  <button type="submit" className="btn inverse" disabled={busy || !path.trim()} style={{ borderRadius: 10 }}>{en.library.importAction}</button>
                </div>
                <small>{en.library.importHelp}</small>
              </label>
            </div>
            <label className="check" style={{ marginTop: 18 }}>
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
              <span>{en.library.includeSubfolders}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} />
              <span>{en.library.copyFiles}<small>{copyFiles ? en.library.copyFilesOn : en.library.copyFilesHelp}</small></span>
            </label>
          </form>
        </section>
      )}
      {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}

      {unfinished && resumeSong && (
        <section className="continue" aria-label={en.library.continueTitle}>
          <Cover songId={resumeSong.id} title={resumeSong.title} hasCover={resumeSong.has_cover} size="large" />
          <div className="continue-body">
            <div className="eyebrow">{en.library.continueTitle}</div>
            <div className="continue-title">{resumeSong.title} <span>· {resumeSong.artist}</span></div>
            <div className="progress-line">
              <div className="bar"><i style={{ width: `${unfinished.total ? (unfinished.answered / unfinished.total) * 100 : 0}%` }} /></div>
              <span>{en.library.difficulty[unfinished.difficulty] ?? unfinished.difficulty} · {unfinished.answered} / {unfinished.total}</span>
            </div>
          </div>
          <a className="btn inverse large" href={paths.game(unfinished.public_id)}>{en.library.resume}</a>
        </section>
      )}

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter">
          {(["all", "ready", "missing"] as const).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {en.library.filters[f]}<small>{counts[f]}</small>
            </button>
          ))}
        </div>
        <input className="pill" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.library.searchPlaceholder} aria-label={en.library.searchPlaceholder} />
      </div>

      {songs.error && <p className="notice error">{songs.error.message}</p>}
      {songs.data && all.length === 0 && <p className="empty">{en.library.empty}</p>}
      {all.length > 0 && shown.length === 0 && <p className="empty">{en.library.noMatch}</p>}
      <ul className="songs">
        {shown.map((s) => (
          <SongRow
            key={s.id} song={s} open={open === s.id} games={(games.data ?? []).filter((g) => g.song_id === s.id)}
            onToggle={() => setOpen(open === s.id ? null : s.id)} onRemove={() => void remove(s)}
          />
        ))}
      </ul>
    </>
  );
}

function SongRow({ song: s, open, games, onToggle, onRemove }: { song: SongDto; open: boolean; games: GameSummaryDto[]; onToggle: () => void; onRemove: () => void }) {
  const ready = s.lyrics_status === "found" && s.available;
  const label = s.available ? en.lyricsStatus[s.lyrics_status] : en.library.fileMissing;
  return (
    <li className="song">
      <div className="song-main">
        <Cover songId={s.id} title={s.title} hasCover={s.has_cover} />
        <div className="song-text">
          <div className="song-title">{s.title}</div>
          <div className="song-meta">
            <span>{s.artist}</span>
            <span className="lang">{s.language}</span>
            <span>{mmss(s.duration)}</span>
          </div>
        </div>
        <div className="status">
          <span className="dot" data-s={s.available ? s.lyrics_status : "not_found"} aria-hidden="true" />
          {label}
        </div>
        <div className="song-actions">
          <button type="button" className="btn quiet danger small" onClick={onRemove} aria-label={`${en.library.remove} ${s.title}`}>{en.library.remove}</button>
          <a className="btn secondary small" href={paths.song(s.id)}>{s.lyrics_status === "found" ? en.library.lyrics : en.library.findLyrics}</a>
        </div>
        <button type="button" className="play-btn" onClick={onToggle} disabled={!ready} aria-expanded={open} aria-label={`${en.library.play} ${s.title}`} title={ready ? en.library.play : en.library.needsLyrics} />
      </div>
      {open && <StartPanel song={s} games={games} />}
    </li>
  );
}

function StartPanel({ song, games }: { song: SongDto; games: GameSummaryDto[] }) {
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const board = useAsync(() => api.songScores(song.id), [song.id]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGame(song.id, difficulty);
      location.hash = paths.game(g.public_id);
    } catch (e) {
      setError(msg(e));
      setBusy(false);
    }
  };

  return (
    <div className="start-panel">
      <div>
        <div className="label">{en.library.difficultyLabel}</div>
        <div className="segmented" role="group" aria-label={en.library.difficultyLabel}>
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
              <b>{en.library.difficulty[d]}</b>
              <small>{PERCENT[d]}% of words</small>
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="btn large" onClick={() => void start()} disabled={busy}>{en.library.startGame}</button>
      <div className="history">
        <History games={games} board={board.data ?? []} />
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
