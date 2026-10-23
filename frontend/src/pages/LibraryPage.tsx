import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { CoverPicker } from "../components/CoverPicker";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { SongMenu, type SongAction } from "../components/SongMenu";
import { Details, Finder } from "../components/SongTools";
import { StatusBadge } from "../components/StatusBadge";
import { FolderBrowser } from "../components/FolderBrowser";
import { LANGUAGES, languageName } from "../components/LanguageSelect";
import { isBool, isOneOf, isString, usePref } from "../lib/prefs";
import { extraCopies, findDuplicates, type DuplicateReason } from "../lib/duplicates";
import { languageCounts } from "../lib/languages";
import { facetCounts, visibleSongs } from "../lib/library-facets";
import { buildMatcher } from "../lib/search";
import { noAutofill } from "../lib/noAutofill";
import { useAsync } from "../hooks/useAsync";
import { useLayout } from "../hooks/useLayout";
import { useLongPress } from "../hooks/useLongPress";
import { useSelection } from "../hooks/useSelection";
import { songStatus } from "../lib/lyrics-status";
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
const AUDIO_RE = /\.(mp3|m4a|flac|ogg|opus|wav)$/i;
type Filter = "all" | "ready" | "missing" | "duplicates";
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
  const [filter, setFilter] = usePref<Filter>("lib_status", "all", isOneOf("all", "ready", "missing", "duplicates"));
  const [query, setQuery] = usePref("lib_query", "", isString);
  const [regex, setRegex] = usePref("lib_regex", false, isBool);
  const [language, setLanguage] = usePref("lib_language", "all", isString);
  const [browsing, setBrowsing] = useState(false);
  const selection = useSelection();
  const phone = useLayout() === "phone";
  const [menu, setMenu] = useState<{ id: number; anchor: HTMLElement } | null>(null);
  const [tool, setTool] = useState<{ kind: "lyrics" | "cover" | "language" | "metadata"; id: number } | null>(null);
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

  const removePicked = async () => {
    const ids = [...selection.picked];
    if (ids.length === 0 || !window.confirm(en.library.removeManyLibrary(ids.length))) return;
    await run(async () => {
      const r = await api.deleteSongs(ids);
      selection.clear();
      return en.library.removedMany(r.hidden + r.deleted);
    });
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeTool = useCallback(() => setTool(null), []);

  const all = songs.data ?? [];
  const duplicates = useMemo(() => findDuplicates(all), [all]);
  const copies = useMemo(() => extraCopies(duplicates), [duplicates]); // the Duplicates filter lists the copies; the oldest song of a group stays out
  const matcher = useMemo(() => buildMatcher(query, regex), [query, regex]);
  const facetOptions = useMemo(() => ({ status: filter, language, matches: matcher.test, duplicateIds: copies.extras }), [filter, language, matcher, copies]);
  const facets = useMemo(() => facetCounts(all, facetOptions), [all, facetOptions]);
  const counts = facets.status;
  const shown = useMemo(() => {
    const list = visibleSongs(all, facetOptions);
    return filter === "duplicates" ? [...list].sort((a, b) => (copies.keeper.get(a.id) ?? 0) - (copies.keeper.get(b.id) ?? 0) || a.id - b.id) : list; // copies of one song sit together
  }, [all, facetOptions, filter, copies]);
  // only what is on screen stays selected, so "N selected" is what Remove deletes
  useEffect(() => selection.keepOnly(new Set(shown.map((x) => x.id))), [shown, selection.keepOnly]);
  useEffect(() => {
    if (!selection.active) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !tool && !menu) selection.clear(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selection, tool, menu]);
  // lyrics are looked up in the background: while any song is still searching, look at the list again every few seconds
  const reload = useRef(songs.reload);
  reload.current = songs.reload;
  const searching = all.some((x) => x.lyrics_status === "pending");
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => { if (!document.hidden) reload.current(); }, 3000);
    return () => clearInterval(t);
  }, [searching]);
  // the last duplicate was removed: do not leave the list on an empty filter
  useEffect(() => { if (songs.data && filter === "duplicates" && copies.extras.size === 0) setFilter("all"); }, [songs.data, filter, copies]);

  // every language of the library keeps its chip (a count of 0 included), so a status or search never hides the way back
  const languages = useMemo(() => languageCounts(all).map((l) => ({ code: l.code, count: facets.languages.find((x) => x.code === l.code)?.count ?? 0 })), [all, facets]);
  // a language that no song has any more (the last one was removed or changed) must not keep an empty list on screen
  // (only once the songs have loaded: before that the list is empty and would wipe the remembered filter)
  useEffect(() => { if (songs.data && language !== "all" && !languages.some((l) => l.code === language)) setLanguage("all"); }, [songs.data, languages, language]);

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
          <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void importPath(); }}>
            <div>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>{en.library.importPath}</span>
                <div className="inline" style={{ alignItems: "stretch", flexWrap: "nowrap" }}>
                  <input type="text" {...noAutofill("import-path")} value={path} onChange={(e) => setPath(e.target.value)} placeholder={en.library.importPlaceholder} style={{ fontSize: 15 }} />
                  <button type="button" className="btn secondary" onClick={() => setBrowsing(true)} style={{ borderRadius: 10 }}>{en.library.browse}</button>
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
      {browsing && (
        <FolderBrowser
          mode="import" start={path.trim() && path.trim().startsWith("/") ? path.trim() : ""} recursiveDefault={recursive} copyDefault={copyFiles}
          onClose={() => setBrowsing(false)}
          onImported={(r) => { setNotice({ kind: r.errors.length ? "error" : "ok", text: `${en.browser.result(r.added, r.skipped, r.filtered ?? 0)}${r.errors.length ? `. ${r.errors.slice(0, 3).join(" ")}` : ""}` }); songs.reload(); }}
        />
      )}

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
          {(["all", "ready", "missing", "duplicates"] as const).filter((f) => f !== "duplicates" || copies.extras.size > 0).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {en.library.filters[f]}<small>{counts[f]}</small>
            </button>
          ))}
        </div>
        <div className="search-box">
          <input className="pill" type="search" {...noAutofill("library-search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.library.searchPlaceholder} aria-label={en.library.searchPlaceholder} aria-invalid={!!matcher.error} />
          <button type="button" className="chip regex-toggle" aria-pressed={regex} onClick={() => setRegex(!regex)} title={en.library.regexToggle} aria-label={en.library.regexToggle}>.*</button>
        </div>
      </div>

      {languages.length > 1 && (
        <div className="chips lang-chips" role="group" aria-label={en.library.languageFilter}>
          <button type="button" className="chip" aria-pressed={language === "all"} onClick={() => setLanguage("all")}>{en.library.allLanguages}</button>
          {languages.map((l) => (
            <button key={l.code} type="button" className="chip" aria-pressed={language === l.code} onClick={() => setLanguage(l.code)} title={languageName(l.code)}>
              {LANGUAGES.some((x) => x.code === l.code) ? languageName(l.code) : l.code.toUpperCase()}<small>{l.count}</small>
            </button>
          ))}
        </div>
      )}
      {matcher.error && <p className="notice error" role="status">{matcher.error}</p>}
      {songs.error && <p className="notice error">{songs.error.message}</p>}
      {songs.data && all.length === 0 && <p className="empty">{en.library.empty}</p>}
      {all.length > 0 && shown.length === 0 && <p className="empty">{en.library.noMatch}</p>}
      {selection.active && (
        <div className="select-bar" role="toolbar" aria-label={en.library.selectedCount(selection.picked.size)}>
          <input
            type="checkbox" className="pick select-all" aria-label={en.library.selectAll(shown.length)} title={en.library.selectAll(shown.length)}
            checked={selection.picked.size > 0 && selection.picked.size === shown.length} ref={(el) => { if (el) el.indeterminate = selection.picked.size > 0 && selection.picked.size < shown.length; }}
            onChange={() => (selection.picked.size === shown.length ? selection.clear() : selection.selectAll(shown.map((x) => x.id)))}
          />
          <strong>{en.library.selectedCount(selection.picked.size)}</strong>
          <button type="button" className="btn danger small" onClick={() => void removePicked()} disabled={busy}>{en.library.removeSelected}</button>
          <button type="button" className="icon-btn" onClick={selection.clear} aria-label={en.library.cancelSelection} title={en.library.cancelSelection}><Icon name="close" /></button>
        </div>
      )}
      <ul className="songs" data-selecting={selection.active}>
        {shown.map((s) => {
          const keeper = copies.keeper.get(s.id);
          return (
            <SongRow
              key={s.id} song={s} phone={phone} selectionActive={selection.active} picked={selection.has(s.id)} onPick={() => selection.toggle(s.id)} onLongPress={() => selection.add(s.id)}
              copyOf={keeper !== undefined ? all.find((x) => x.id === keeper)?.title : undefined} duplicate={copies.reasons.get(s.id)}
              open={open === s.id} games={(games.data ?? []).filter((g) => g.song_id === s.id)} menuOpen={menu?.id === s.id}
              onToggle={() => setOpen(open === s.id ? null : s.id)} onMenu={(anchor) => setMenu(menu?.id === s.id ? null : { id: s.id, anchor })}
              onFix={() => { const st = songStatus(s); if (st.fix === "lyrics") setTool({ kind: "lyrics", id: s.id }); else if (st.fix === "file") void remove(s); }}
            />
          );
        })}
      </ul>
      {menu && (() => {
        const s = all.find((x) => x.id === menu.id);
        return s ? (
          <SongMenu
            song={s} status={songStatus(s)} phone={phone} anchor={menu.anchor} onClose={closeMenu}
            onPick={(a: SongAction) => { setMenu(null); if (a === "remove") void remove(s); else setTool({ kind: a, id: s.id }); }}
          />
        ) : null;
      })()}
      {tool && (() => {
        const s = all.find((x) => x.id === tool.id);
        if (!s) return null;
        return (
          <Dialog title={en.songMenu.titles[tool.kind] ?? ""} subtitle={`${s.title} · ${s.artist}`} onClose={closeTool}>
            {tool.kind === "lyrics" && <Finder bare song={s} hasLyrics={s.lyrics_status === "found"} onAttached={songs.reload} />}
            {tool.kind === "cover" && <CoverPicker bare song={s} onChanged={songs.reload} />}
            {tool.kind === "language" && <Details bare part="language" song={s} onSaved={songs.reload} />}
            {tool.kind === "metadata" && <Details bare part="metadata" song={s} onSaved={songs.reload} />}
          </Dialog>
        );
      })()}
    </>
  );
}

interface RowProps {
  song: SongDto;
  phone: boolean;
  selectionActive: boolean;
  picked: boolean;
  onPick: () => void;
  onLongPress: () => void;
  duplicate?: DuplicateReason[];
  copyOf?: string;
  open: boolean;
  games: GameSummaryDto[];
  menuOpen: boolean;
  onToggle: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onFix: () => void;
}

function SongRow({ song: s, phone, selectionActive, picked, onPick, onLongPress, duplicate, copyOf, open, games, menuOpen, onToggle, onMenu, onFix }: RowProps) {
  const ready = s.lyrics_status === "found" && s.available;
  const status = songStatus(s);
  const press = useLongPress({ onLongPress });
  const dots = useRef<HTMLButtonElement>(null);
  const rowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, label")) return;
    if (press.consumeClick()) return;
    if (selectionActive) onPick();
    else if (phone && ready) onToggle(); // phones have no play button: a tap opens the play options
  };
  return (
    <li className="song">
      <div className="song-main" data-picked={picked} data-open={open} data-selecting={selectionActive} onClick={rowClick} {...(phone ? press.handlers : {})}>
        <input type="checkbox" className="pick" checked={picked} onChange={onPick} aria-label={en.library.pick(s.title)} />
        <Cover songId={s.id} title={s.title} hasCover={s.has_cover} size="row" />
        <div className="song-text">
          <div className="song-title" title={s.title}>{s.title}</div>
          <div className="song-meta">
            <span title={s.artist}>{s.artist}</span>
            <span className="lang">{s.language}</span>
            <span>{mmss(s.duration)}</span>
            {duplicate && <span className="dup-tag" title={duplicate.map((r) => en.library.duplicateReason[r]).join(" · ")}>{copyOf ? en.library.copyOf(copyOf) : en.library.duplicateHint}</span>}
          </div>
        </div>
        <div className="status-cell"><StatusBadge status={status} phone={phone} onFix={onFix} /></div>
        {!phone && <button type="button" className="play-btn" onClick={onToggle} disabled={!ready} aria-expanded={open} aria-label={`${en.library.play} ${s.title}`} title={ready ? en.library.play : en.library.needsLyrics} />}
        <button type="button" ref={dots} className="kebab" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={en.songMenu.open(s.title)} onClick={() => dots.current && onMenu(dots.current)}><Icon name="more" /></button>
      </div>
      {open && <StartPanel song={s} games={games} />}
    </li>
  );
}

function StartPanel({ song, games }: { song: SongDto; games: GameSummaryDto[] }) {
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<GameMode>("choice");
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
        <div className="segmented mode-switch" role="group" aria-label={en.library.modeLabel}>
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
        <div className="segmented" role="group" aria-label={en.library.difficultyLabel}>
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
