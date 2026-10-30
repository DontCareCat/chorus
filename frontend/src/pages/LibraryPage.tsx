import { useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { ActionMenu } from "../components/ActionMenu";
import { LookupBar } from "../components/LookupBar";
import { AddToPlaylist } from "../components/AddToPlaylist";
import { LibraryTabs } from "../components/LibraryTabs";
import { useConfirm } from "../components/Confirm";
import { YouTubeAdd } from "../components/YouTubeAdd";
import { SongList } from "../components/SongList";
import { useQueueActions } from "../hooks/useQueueActions";
import { SortControl } from "../components/SortControl";
import { FolderBrowser } from "../components/FolderBrowser";
import { LANGUAGES, languageName } from "../components/LanguageSelect";
import { isBool, isOneOf, isString, usePref } from "../lib/prefs";
import { extraCopies, findDuplicates } from "../lib/duplicates";
import { languageCounts } from "../lib/languages";
import { keepUnchanged } from "../lib/keep-unchanged";
import { facetCounts, visibleSongs } from "../lib/library-facets";
import { readAddTab, startTab, writeAddTab } from "../lib/youtube-add";
import type { AddTab } from "../lib/youtube-add";
import { buildMatcher } from "../lib/search";
import { SORT_KEYS, sortSongs } from "../lib/library-sort";
import type { SortChoice } from "../lib/library-sort";
import { noAutofill } from "../lib/noAutofill";
import { useAsync } from "../hooks/useAsync";
import { useLayout } from "../hooks/useLayout";
import { useSelection } from "../hooks/useSelection";
import { useThumb } from "../hooks/useThumb";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { SongDto } from "../services/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
const AUDIO_RE = /\.(mp3|m4a|flac|ogg|opus|wav)$/i;
type Filter = "all" | "ready" | "missing" | "duplicates" | "youtube";

export function LibraryPage() {
  const previous = useRef<SongDto[]>([]);
  // a reload gives back the very objects of the songs that did not change, so the list re-renders only the rows that did
  const songs = useAsync(() => api.songs().then((next) => (previous.current = keepUnchanged(previous.current, next))), []);
  const games = useAsync(() => api.myGames(), []);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [path, setPath] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [copyFiles, setCopyFiles] = useState(false);
  const [filter, setFilter] = usePref<Filter>("lib_status", "all", isOneOf("all", "ready", "missing", "duplicates", "youtube"));
  const [query, setQuery] = usePref("lib_query", "", isString);
  const [regex, setRegex] = usePref("lib_regex", false, isBool);
  const [language, setLanguage] = usePref("lib_language", "all", isString);
  const [sortKey, setSortKey] = usePref("lib_sort", "name" as SortChoice["key"], isOneOf(...SORT_KEYS));
  const [sortDir, setSortDir] = usePref("lib_sort_dir", "default" as SortChoice["dir"], isOneOf("default", "reverse"));
  const sort: SortChoice = { key: sortKey, dir: sortDir };
  const [browsing, setBrowsing] = useState(false);
  const queue = useQueueActions();
  const [barMenu, setBarMenu] = useState(false);
  const barMenuBtn = useRef<HTMLButtonElement>(null);
  const [playlistFor, setPlaylistFor] = useState<number[] | null>(null);
  const selection = useSelection();
  const statusThumb = useThumb();
  const langThumb = useThumb();
  const phone = useLayout() === "phone";
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const appSettings = useAsync(() => api.settings(), []);
  const youtubeOn = appSettings.data?.youtube_enabled !== false;
  const [tabChoice, setTabChoice] = useState<AddTab | null>(() => readAddTab());
  const tab: AddTab = tabChoice && (tabChoice !== "youtube" || youtubeOn) ? tabChoice : startTab(youtubeOn);
  const chooseTab = (t: AddTab) => { setTabChoice(t); writeAddTab(t); };
  const tabs: AddTab[] = youtubeOn ? ["youtube", "files", "folder"] : ["files", "folder"];
  const tabThumb = useThumb();
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", ""); // not part of React's input typings
  }, [addOpen, tab]);

  const confirm = useConfirm();
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
    const sure = await confirm(s.source === "library"
      ? { title: en.library.removeLibrary(s.title), body: en.library.removeLibraryBody, action: en.library.removeAction }
      : s.source === "youtube"
        ? { title: en.library.removeYouTube(s.title), body: en.library.removeYouTubeBody, action: en.library.removeAction }
        : { title: en.library.removeCopy(s.title), body: en.library.removeCopyBody, action: en.library.deleteAction });
    if (!sure) return;
    await run(async () => {
      await api.deleteSong(s.id);
      return en.library.removed(s.title);
    });
  };

  const removePicked = async () => {
    const ids = [...selection.picked];
    if (ids.length === 0 || !(await confirm({ title: en.library.removeManyLibrary(ids.length), body: en.library.removeManyBody, action: en.library.removeAction }))) return;
    await run(async () => {
      const r = await api.deleteSongs(ids);
      selection.clear();
      return en.library.removedMany(r.hidden + r.deleted);
    });
  };

  const retryLyrics = async (ids?: number[]) => {
    await run(async () => {
      const r = await api.retryLyrics(ids);
      selection.clear();
      return en.library.lyricsQueued(r.queued);
    });
  };

  const all = songs.data ?? [];
  const missingLyrics = all.filter((s) => s.lyrics_status === "not_found" || s.lyrics_status === "pending").length;
  const duplicates = useMemo(() => findDuplicates(all), [all]);
  const copies = useMemo(() => extraCopies(duplicates), [duplicates]); // the Duplicates filter lists the copies; the oldest song of a group stays out
  const matcher = useMemo(() => buildMatcher(query, regex), [query, regex]);
  const facetOptions = useMemo(() => ({ status: filter, language, matches: matcher.test, duplicateIds: copies.extras }), [filter, language, matcher, copies]);
  const facets = useMemo(() => facetCounts(all, facetOptions), [all, facetOptions]);
  const counts = facets.status;
  const hasYouTube = all.some((s) => s.source === "youtube");
  const shown = useMemo(() => {
    const list = visibleSongs(all, facetOptions);
    return filter === "duplicates" ? [...list].sort((a, b) => (copies.keeper.get(a.id) ?? 0) - (copies.keeper.get(b.id) ?? 0) || a.id - b.id) : sortSongs(list, { key: sortKey, dir: sortDir }); // copies of one song sit together
  }, [all, facetOptions, filter, copies, sortKey, sortDir]);
  // only what is on screen stays selected, so "N selected" is what Remove deletes
  useEffect(() => selection.keepOnly(new Set(shown.map((x) => x.id))), [shown, selection.keepOnly]);
  useEffect(() => {
    if (!selection.active) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".song-menu, .sheet, .dialog")) selection.clear(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selection]);
  // lyrics are looked up in the background: while any song is still searching, look at the list again every few seconds
  const reload = useRef(songs.reload);
  reload.current = songs.reload;
  const loading = useRef(false);
  loading.current = songs.loading;
  const searching = all.some((x) => x.lyrics_status === "pending");
  // the list is asked again every few seconds while lookups run; when an answer brings nothing new the wait doubles (up to 30 s), so
  // lookups that make no progress (the service is down) cost next to nothing
  const lastSeen = useRef<SongDto[] | null>(null);
  const wait = useRef(3000);
  useEffect(() => {
    if (!searching) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!document.hidden && !loading.current) {
        wait.current = lastSeen.current === songs.data ? Math.min(30000, wait.current * 2) : 3000;
        lastSeen.current = songs.data;
        reload.current();
      }
      timer = setTimeout(tick, wait.current);
    };
    timer = setTimeout(tick, wait.current);
    return () => clearTimeout(timer);
  }, [searching, songs.data]);
  useEffect(() => { if (songs.data && filter === "youtube" && !hasYouTube) setFilter("all"); }, [songs.data, filter, hasYouTube]);
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
          <LibraryTabs current="songs" />
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
        <section className="add-panel add-tabbed" aria-label={en.library.addMusic}>
          <div className="add-tabs segmented thumbs" role="group" aria-label={en.library.addTabs} ref={tabThumb}>
            {tabs.map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => chooseTab(t)}>{{ youtube: en.library.tabYouTube, files: en.library.tabFiles, folder: en.library.tabFolder }[t]}</button>
            ))}
          </div>
          {tab === "youtube" && youtubeOn && (
            <YouTubeAdd
              phone={phone}
              onPlaylistAdded={() => songs.reload()}
              onAdded={(song) => { setNotice({ kind: "ok", text: en.library.youtubeAdded(song.title) }); songs.reload(); }}
              onShow={(title) => { setFilter("all"); setLanguage("all"); setRegex(false); setQuery(title); }}
            />
          )}
          {tab === "files" && (
          <div className="add-body">
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
              {missingLyrics > 0 && <button type="button" className="btn secondary small" onClick={() => void retryLyrics()} disabled={busy}>{en.library.findMissingLyrics(missingLyrics)}</button>}
              <button type="button" className="btn secondary small scan-in" onClick={scan} disabled={busy}>{busy ? en.library.scanning : en.library.scan}</button>
            </div>
          </div>
          )}
          {tab === "folder" && (
          <form autoComplete="off" className="add-body" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void importPath(); }}>
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
          )}
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
          <Cover songId={resumeSong.id} title={resumeSong.title} hasCover={resumeSong.has_cover} youtubeId={resumeSong.youtube_id} size="large" />
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
        <div className="chips thumbs" role="group" aria-label="Filter" ref={statusThumb}>
          {(["all", "ready", "missing", "duplicates", "youtube"] as const).filter((f) => (f !== "duplicates" || copies.extras.size > 0) && (f !== "youtube" || hasYouTube)).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {en.library.filters[f]}<small key={f === "youtube" ? facets.youtube : counts[f]}>{f === "youtube" ? facets.youtube : counts[f]}</small>
            </button>
          ))}
        </div>
        <div className="queue-actions">
          <button type="button" className="btn secondary small" disabled={shown.length === 0} onClick={() => void queue.play(shown, false)}><Icon name="play" />{en.queue.playAll}</button>
          <button type="button" className="btn secondary small" disabled={shown.length === 0} onClick={() => void queue.play(shown, true)}><Icon name="shuffle" />{en.queue.shuffle}</button>
        </div>
        <SortControl choice={sort} onChange={(c) => { setSortKey(c.key); setSortDir(c.dir); }} />
        <div className="search-box">
          <input className="pill" type="search" {...noAutofill("library-search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.library.searchPlaceholder} aria-label={en.library.searchPlaceholder} aria-invalid={!!matcher.error} />
          <button type="button" className="chip regex-toggle" aria-pressed={regex} onClick={() => setRegex(!regex)} title={en.library.regexToggle} aria-label={en.library.regexToggle}>.*</button>
        </div>
      </div>

      {languages.length > 1 && (
        <div className="chips lang-chips thumbs" role="group" aria-label={en.library.languageFilter} ref={langThumb}>
          <button type="button" className="chip" aria-pressed={language === "all"} onClick={() => setLanguage("all")}>{en.library.allLanguages}</button>
          {languages.map((l) => (
            <button key={l.code} type="button" className="chip" aria-pressed={language === l.code} onClick={() => setLanguage(l.code)} title={languageName(l.code)}>
              {LANGUAGES.some((x) => x.code === l.code) ? languageName(l.code) : l.code.toUpperCase()}<small key={l.count}>{l.count}</small>
            </button>
          ))}
        </div>
      )}
      <LookupBar songs={all} busy={busy} ready={songs.data !== null} onRetry={() => void retryLyrics()} />
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
          <button type="button" className="icon-btn" ref={barMenuBtn} onClick={() => setBarMenu((v) => !v)} aria-haspopup="menu" aria-expanded={barMenu} aria-label={en.library.moreActions} title={en.library.moreActions} disabled={selection.picked.size === 0}><Icon name="more" /></button>
          <button type="button" className="icon-btn danger" onClick={() => void removePicked()} disabled={busy || selection.picked.size === 0} aria-label={en.library.removeSelected} title={en.library.removeSelected}><Icon name="trash" /></button>
          <button type="button" className="icon-btn" onClick={selection.clear} aria-label={en.library.cancelSelection} title={en.library.cancelSelection}><Icon name="close" /></button>
        </div>
      )}
      {barMenu && (
        <ActionMenu
          label={en.library.selectedCount(selection.picked.size)} phone={phone} anchor={barMenuBtn.current} onClose={() => setBarMenu(false)}
          items={[{ id: "playlist", icon: "playlistAdd", label: en.playlists.addTo }, { id: "lyrics", icon: "search", label: en.library.findLyrics }]}
          onPick={(id) => { if (id === "playlist") setPlaylistFor([...selection.picked]); else void retryLyrics([...selection.picked]); }}
        />
      )}
      <SongList
        songs={shown} games={games.data ?? []} phone={phone} sortKey={filter === "duplicates" ? null : sortKey} listKey={`${filter}|${language}|${sortKey}|${sortDir}`}
        selection={selection} reload={songs.reload} onRemove={(s) => void remove(s)}
        extras={() => [{ id: "playlist", icon: "playlistAdd", label: en.playlists.addTo }]} onExtra={(id, s) => { if (id === "playlist") setPlaylistFor([s.id]); }}
        duplicate={(s) => { const r = copies.reasons.get(s.id); const k = copies.keeper.get(s.id); return r ? { reasons: r, copyOf: k !== undefined ? all.find((x) => x.id === k)?.title : undefined } : undefined; }}
      />
      {playlistFor && (
        <AddToPlaylist
          songIds={playlistFor} subtitle={playlistFor.length === 1 ? (() => { const s = all.find((x) => x.id === playlistFor[0]); return s ? `${s.title} · ${s.artist}` : undefined; })() : undefined}
          onClose={() => setPlaylistFor(null)}
        />
      )}
    </>
  );
}
