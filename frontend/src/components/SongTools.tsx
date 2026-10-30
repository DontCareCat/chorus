import { useEffect, useRef, useState } from "react";
import { LanguageSelect, languageName } from "./LanguageSelect";
import { noAutofill } from "../lib/noAutofill";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { CandidateDto, LyricsDto, SongDto } from "../services/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
type Notice = { kind: "ok" | "error"; text: string } | null;

/** `part`: the whole form (song page), only title / artist / album, or only the language. */
export function Details({ song, onSaved, part = "all", bare = false }: { song: SongDto; onSaved: () => void; part?: "all" | "metadata" | "language"; bare?: boolean }) {
  const [f, setF] = useState({ title: song.title, artist: song.artist, album: song.album ?? "", language: song.language });
  const [notice, setNotice] = useState<Notice>(null);
  const [detecting, setDetecting] = useState(false);
  useEffect(() => setF((x) => ({ ...x, language: song.language })), [song.language]); // a detected language shows up in the field
  const detect = async () => {
    setDetecting(true);
    setNotice(null);
    try {
      const s = await api.detectLanguage(song.id);
      setNotice({ kind: "ok", text: en.song.languageDetected(languageName(s.language)) });
      onSaved();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    } finally {
      setDetecting(false);
    }
  };
  const save = async () => {
    try {
      await api.patchSong(song.id, { title: f.title, artist: f.artist, album: f.album || null, language: f.language });
      setNotice({ kind: "ok", text: en.song.saved });
      onSaved();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  const Wrap = bare ? "div" : "section";
  return (
    <Wrap className={bare ? undefined : "panel"}>
      {!bare && <h2>{part === "language" ? en.song.language : en.song.details}</h2>}
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {part !== "language" && (["title", "artist", "album"] as const).map((k) => (
          <label className="field" key={k}>
            <span>{en.song[k]}</span>
            <input type="text" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...noAutofill(`song-${k}`)} />
          </label>
        ))}
        {part !== "metadata" && <div className="field">
          <span>{en.song.language}</span>
          <div className="inline" style={{ alignItems: "center", flexWrap: "nowrap" }}>
            <LanguageSelect value={f.language} onChange={(language) => setF({ ...f, language })} />
            <button type="button" className="btn secondary small" onClick={() => void detect()} disabled={detecting} style={{ flex: "none" }}>{detecting ? en.song.detecting : en.song.detectLanguage}</button>
          </div>
          <small>{en.song.languageSource[song.language_source]}</small>
        </div>}
        <button type="submit" className="btn">{en.song.save}</button>
        {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      </form>
    </Wrap>
  );
}


/** m:ss */
const clock = (seconds: number): string => { const total = Math.round(seconds); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; };

export function Finder({ song, hasLyrics, onAttached, bare = false }: { song: SongDto; hasLyrics: boolean; onAttached: () => void; bare?: boolean }) {
  const [q, setQ] = useState(`${song.artist} ${song.title}`.trim());
  const [candidates, setCandidates] = useState<CandidateDto[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const guard = async (job: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    } finally {
      setBusy(false);
    }
  };
  const attached = (l: LyricsDto) => {
    setCandidates(null);
    setWarnings(l.warnings);
    setNotice({ kind: "ok", text: hasLyrics ? `${en.song.attached}. ${en.song.switchedNote}` : en.song.attached });
    onAttached();
  };
  const auto = () =>
    guard(async () => {
      // With lyrics already saved, automatic search only lists candidates: the old behaviour (re-attach the same
      // match) made it impossible to change them.
      const d = await api.discover(song.id, hasLyrics ? "replace" : "auto");
      if (d.error) throw new ApiError("lrclib_unavailable", en.song.unavailable, 502);
      setHidden(d.unsynced_hidden);
      if (d.status === "found" && d.lyrics) attached(d.lyrics);
      else setCandidates(d.candidates);
    });
  const search = () =>
    guard(async () => {
      setHidden(0);
      setCandidates(await api.searchLyrics(song.id, q));
    });
  const use = (c: CandidateDto) => guard(async () => attached(await api.attachLyrics(song.id, c.id)));
  const upload = (f: File | undefined) =>
    f &&
    guard(async () => {
      const l = await api.uploadLyrics(song.id, f);
      if (file.current) file.current.value = "";
      attached(l);
    });

  const Wrap = bare ? "div" : "section";
  return (
    <Wrap className={bare ? undefined : "panel"}>
      {!bare && <h2>{hasLyrics ? en.song.replace : en.song.find}</h2>}
      {hasLyrics && <p className="muted" style={{ marginBottom: 14 }}>{en.song.chooseHelp}</p>}
      <p className="muted song-length" style={{ marginBottom: 10 }}>{song.duration > 0 ? en.song.thisSong(clock(song.duration)) : en.song.lengthUnknown}</p>
      <p style={{ marginBottom: 14 }}><button type="button" className="btn" onClick={() => void auto()} disabled={busy}>{hasLyrics ? en.song.findAgain : en.song.findAuto}</button></p>
      <form autoComplete="off" className="inline" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <label className="field">
          <span>{en.song.search}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={en.song.searchPlaceholder} {...noAutofill("lyrics-search")} />
        </label>
        <button type="submit" className="btn secondary" disabled={busy || !q.trim()}>{en.song.search}</button>
      </form>
      <p style={{ marginTop: 14 }}>
        <label className="btn quiet bordered small">
          {en.song.uploadLyrics}
          <input ref={file} type="file" accept=".lrc,.txt,text/plain" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      </p>
      {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      {warnings.map((w) => <p className="notice" key={w}>{w}</p>)}
      {hidden > 0 && <p className="notice">{en.song.hiddenUnsynced(hidden)} <a href={paths.settings()}>{en.nav.settings}</a></p>}
      {candidates && candidates.length === 0 && <p className="muted">{en.song.nothingFound}</p>}
      {candidates && candidates.length > 0 && (
        <ul className="candidates">
          {candidates.map((c) => (
            <li key={c.id} data-usable={c.usable} data-in-use={c.in_use}>
              <div>
                <strong>{c.artist}: {c.title}</strong> <span className="cand-len">{clock(c.duration)}</span>
                <div className="muted">
                  {song.duration > 0 && <>{en.song.off(Math.round(c.duration - song.duration))} · </>}{c.synced ? en.song.synced : en.song.unsynced}
                  {!c.usable && !c.instrumental && <> · {en.song.unsyncedNeedsSetting}</>}
                  {c.instrumental && " · instrumental"}
                </div>
              </div>
              {c.in_use ? <span className="tag">{en.song.inUse}</span> : <button type="button" className="btn small" disabled={!c.usable || busy} onClick={() => void use(c)}>{en.song.useThese}</button>}
            </li>
          ))}
        </ul>
      )}
    </Wrap>
  );
}
