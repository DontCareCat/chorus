import { useEffect, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { LanguageSelect } from "../components/LanguageSelect";
import { timecode } from "../game/lyric-window";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { CandidateDto, LyricsDto, SongDto } from "../services/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
type Notice = { kind: "ok" | "error"; text: string } | null;

export function SongPage({ songId }: { songId: number }) {
  const song = useAsync(() => api.songs().then((l) => l.find((s) => s.id === songId) ?? Promise.reject(new ApiError("song_not_found", "Song not found", 404))), [songId]);
  const lyrics = useAsync<LyricsDto | null>(() => api.lyrics(songId).catch((e: unknown) => (e instanceof ApiError && e.code === "no_lyrics" ? null : Promise.reject(e))), [songId]);

  if (song.error) return <p className="notice error">{song.error.message}</p>;
  if (!song.data) return <p className="muted">…</p>;
  const s = song.data;

  return (
    <>
      <a className="crumb" href={paths.library()}>← {en.song.back}</a>
      <div className="page-head with-cover">
        <Cover songId={s.id} title={s.title} hasCover={s.has_cover} size="xl" />
        <div>
          <h1>{s.title}</h1>
          <div className="song-meta">
            <span>{s.artist}</span>
            {s.album && <span>{s.album}</span>}
            <span className="lang">{s.language}</span>
          </div>
        </div>
      </div>
      <div className="two-col">
        <Timing song={s} lyrics={lyrics.data} onSaved={song.reload} />
        <div>
          <Finder song={s} hasLyrics={!!lyrics.data} onAttached={() => { lyrics.reload(); song.reload(); }} />
          <Details song={s} onSaved={song.reload} />
        </div>
      </div>
    </>
  );
}

function Details({ song, onSaved }: { song: SongDto; onSaved: () => void }) {
  const [f, setF] = useState({ title: song.title, artist: song.artist, album: song.album ?? "", language: song.language });
  const [notice, setNotice] = useState<Notice>(null);
  const save = async () => {
    try {
      await api.patchSong(song.id, { title: f.title, artist: f.artist, album: f.album || null, language: f.language });
      setNotice({ kind: "ok", text: en.song.saved });
      onSaved();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  return (
    <section className="panel">
      <h2>{en.song.details}</h2>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {(["title", "artist", "album"] as const).map((k) => (
          <label className="field" key={k}>
            <span>{en.song[k]}</span>
            <input type="text" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </label>
        ))}
        <label className="field">
          <span>{en.song.language}</span>
          <LanguageSelect value={f.language} onChange={(language) => setF({ ...f, language })} />
        </label>
        <button type="submit" className="btn">{en.song.save}</button>
        {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      </form>
    </section>
  );
}

/** Listen with the current lyrics highlighted; nudge the timing until the highlight matches the singing. */
function Timing({ song, lyrics, onSaved }: { song: SongDto; lyrics: LyricsDto | null; onSaved: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [offset, setOffset] = useState(song.lyrics_offset);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => setOffset(song.lyrics_offset), [song.lyrics_offset]);
  useEffect(() => {
    const t = setInterval(() => setNow(audio.current?.currentTime ?? 0), 100);
    return () => clearInterval(t);
  }, []);

  const lines = lyrics?.lines ?? [];
  // audioTime = lyricTime + offset (same convention as the game)
  const active = lyrics?.is_synced ? lines.findIndex((l) => l.start_time !== null && l.end_time !== null && now >= l.start_time + offset && now < l.end_time + offset) : -1;
  const nudge = (d: number) => setOffset((o) => Math.round((o + d) * 10) / 10);
  const save = async () => {
    try {
      await api.patchSong(song.id, { lyrics_offset: offset });
      setNotice({ kind: "ok", text: en.song.saved });
      onSaved();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  return (
    <section className="section">
      <h2>{en.song.currentLyrics}</h2>
      {!lyrics && <p className="muted">{en.song.noLyrics}</p>}
      {lyrics && (
        <>
          <audio ref={audio} src={api.audioUrl(song.id)} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          <div className="controls" style={{ gap: 12 }}>
            <button type="button" className="icon-btn big" onClick={toggle} aria-label={playing ? en.game.pause : en.game.play} title={playing ? en.game.pause : en.game.play}>
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <span className="transport-time" style={{ textAlign: "left" }}>{timecode(now)} / {timecode(song.duration)}</span>
          </div>
          {lyrics.is_synced ? (
            <>
              <p className="muted" style={{ marginTop: 14 }}>{en.song.offsetHelp}</p>
              <div className="offset-row">
                <button type="button" className="btn secondary small" onClick={() => nudge(-0.1)}>{en.song.earlier}</button>
                <span className="offset-value" aria-live="polite">{offset > 0 ? "+" : ""}{offset.toFixed(1)} s</span>
                <button type="button" className="btn secondary small" onClick={() => nudge(0.1)}>{en.song.later}</button>
                <button type="button" className="btn small" onClick={() => void save()} disabled={offset === song.lyrics_offset}>{en.song.saveOffset}</button>
              </div>
              {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
            </>
          ) : (
            <p className="notice">{en.song.unsynced}</p>
          )}
          {lyrics.warnings.map((w) => <p className="notice" key={w}>{w}</p>)}
          <ol className="lyric-lines" aria-label="Lyrics">
            {lines.map((l, i) => (
              <li
                key={l.sequence}
                className="lyric-line"
                aria-current={i === active}
                onClick={() => { if (audio.current && l.start_time !== null) { audio.current.currentTime = Math.max(0, l.start_time + offset); void audio.current.play(); } }}
              >
                <time>{timecode(l.start_time)}</time>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Finder({ song, hasLyrics, onAttached }: { song: SongDto; hasLyrics: boolean; onAttached: () => void }) {
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

  return (
    <section className="panel">
      <h2>{hasLyrics ? en.song.replace : en.song.find}</h2>
      {hasLyrics && <p className="muted" style={{ marginBottom: 14 }}>{en.song.chooseHelp}</p>}
      <p style={{ marginBottom: 14 }}><button type="button" className="btn" onClick={() => void auto()} disabled={busy}>{hasLyrics ? en.song.findAgain : en.song.findAuto}</button></p>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <label className="field">
          <span>{en.song.search}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={en.song.searchPlaceholder} />
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
                <strong>{c.artist}: {c.title}</strong>
                <div className="muted">
                  {Math.floor(c.duration / 60)}:{String(Math.round(c.duration % 60)).padStart(2, "0")}, {c.synced ? en.song.synced : en.song.unsynced}
                  {!c.usable && !c.instrumental && <> · {en.song.unsyncedNeedsSetting}</>}
                  {c.instrumental && " · instrumental"}
                </div>
              </div>
              {c.in_use ? <span className="tag">{en.song.inUse}</span> : <button type="button" className="btn small" disabled={!c.usable || busy} onClick={() => void use(c)}>{en.song.useThese}</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
