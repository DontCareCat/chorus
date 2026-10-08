import { useEffect, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { GameSummaryDto, SongDto } from "../services/api";

const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);

const AUDIO_RE = /\.(mp3|m4a|flac|ogg|opus|wav)$/i;

export function LibraryPage() {
  const songs = useAsync(() => api.songs(), []);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [copyFiles, setCopyFiles] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", ""); // not part of React's input typings
  }, []);

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

  const upload = (files: FileList | null) =>
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

  return (
    <>
      <div className="page-head"><h1>{en.library.title}</h1></div>

      <section className="add-songs" aria-label="Add songs">
        <div className="inline">
          <button type="button" className="btn" onClick={scan} disabled={busy}>{busy ? en.library.scanning : en.library.scan}</button>
          <label className="btn quiet" style={{ cursor: "pointer" }}>
            {en.library.upload}
            <input ref={fileRef} type="file" accept=".mp3,.m4a,.flac,.ogg,.opus,.wav,audio/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
          </label>
          <label className="btn quiet" style={{ cursor: "pointer" }}>
            {en.library.uploadFolder}
            <input ref={folderRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
          </label>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (path.trim()) void importPath(); }}>
          <div className="inline">
            <label className="field">
              <span>{en.library.importPath}</span>
              <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder={en.library.importPlaceholder} />
              <small>{en.library.importHelp}</small>
            </label>
            <button type="submit" className="btn quiet" disabled={busy || !path.trim()}>{en.library.importAction}</button>
          </div>
          <div className="inline" style={{ marginTop: "0.75rem", gap: "1.5rem", alignItems: "flex-start" }}>
            <label className="check" style={{ marginBottom: 0 }}>
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
              <span>{en.library.includeSubfolders}</span>
            </label>
            <label className="check" style={{ marginBottom: 0 }}>
              <input type="checkbox" checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} />
              <span><strong>{en.library.copyFiles}</strong><small>{en.library.copyFilesHelp}</small></span>
            </label>
          </div>
        </form>
        {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      </section>

      {songs.error && <p className="notice error">{songs.error.message}</p>}
      {songs.data && songs.data.length === 0 && <p className="empty">{en.library.empty}</p>}
      <ul className="songs">
        {songs.data?.map((s) => (
          <SongRow key={s.id} song={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} onRemove={() => void remove(s)} />
        ))}
      </ul>
    </>
  );
}

function SongRow({ song: s, open, onToggle, onRemove }: { song: SongDto; open: boolean; onToggle: () => void; onRemove: () => void }) {
  const ready = s.lyrics_status === "found" && s.available;
  const mins = `${Math.floor(s.duration / 60)}:${String(Math.round(s.duration % 60)).padStart(2, "0")}`;
  return (
    <li className="song">
      <div className="song-main">
        <Cover songId={s.id} hasCover={s.has_cover} />
        <div>
          <div className="song-title">{s.title}</div>
          <div className="song-meta">
            <span>{[s.artist, s.language, mins].filter(Boolean).join(", ")}</span>
            <span>
              <span className="dot" data-s={s.lyrics_status} aria-hidden="true" />
              {s.available ? en.lyricsStatus[s.lyrics_status] : en.library.fileMissing}
            </span>
          </div>
        </div>
        <div className="song-actions">
          <button type="button" className="btn quiet small" onClick={onRemove} aria-label={`${en.library.remove} ${s.title}`}>{en.library.remove}</button>
          <a className="btn quiet small" href={paths.song(s.id)}>{en.library.lyrics}</a>
          <button type="button" className="btn small" onClick={onToggle} disabled={!ready} aria-expanded={open}>{en.library.play}</button>
        </div>
      </div>
      {open && <StartPanel song={s} />}
    </li>
  );
}

function StartPanel({ song }: { song: SongDto }) {
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const games = useAsync(() => api.songGames(song.id), [song.id]);

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
      <div className="inline">
        <div className="segmented" role="group" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)} title={en.library.difficultyShare[d]}>{en.library.difficulty[d]}</button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => void start()} disabled={busy}>{en.library.startGame}</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>{en.library.difficultyShare[difficulty]}</p>
      {error && <p className="notice error">{error}</p>}
      <PastGames games={games.data} />
    </div>
  );
}

function PastGames({ games }: { games: GameSummaryDto[] | null }) {
  if (!games || games.length === 0) return games ? <p className="muted">{en.library.noGames}</p> : null;
  return (
    <ul className="past-games">
      {games.map((g) => (
        <li key={g.public_id}>
          <a href={paths.game(g.public_id)}>
            {en.library.difficulty[g.difficulty] ?? g.difficulty}, {new Date(g.started_at).toLocaleDateString()}
          </a>{" "}
          <small>{g.finished_at ? en.library.gameFinished(g.score) : en.library.gameInProgress}</small>
        </li>
      ))}
    </ul>
  );
}
