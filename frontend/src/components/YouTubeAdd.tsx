import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { classifyInput, isTopicChannel, parsePlaylistId, youtubeThumb } from "../lib/youtube-add";
import { SpotifyPlaylistImport } from "./SpotifyPlaylistImport";
import { SpotifyTrackImport } from "./SpotifyTrackImport";
import { TrackListImport } from "./TrackListImport";
import { YouTubeSearch } from "./YouTubeSearch";
import { YouTubePlaylistImport } from "./YouTubePlaylistImport";
import { api, ApiError } from "../services/api";
import type { SongDto, YouTubePreviewDto } from "../services/api";

const CHECK_DELAY = 400; // ms after the last keystroke; a paste checks at once

type Check = { state: "idle" } | { state: "checking" } | { state: "ready"; preview: YouTubePreviewDto } | { state: "error"; message: string };

/** The YouTube link tab of Add music: paste, check, preview, edit title and artist, add. */
export function YouTubeAdd({ phone, onAdded, onShow, onPlaylistAdded }: { phone: boolean; onAdded: (song: SongDto) => void; onShow: (title: string) => void; onPlaylistAdded?: () => void }) {
  const [link, setLink] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  const immediate = useRef(false);
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  useEffect(() => {
    setAddError(null);
    const text = link.trim();
    const kind = classifyInput(text);
    if (kind !== "video" && kind !== "link") { setCheck({ state: "idle" }); return; } // playlists, searches and an empty field have their own parts below
    setCheck((c) => (c.state === "ready" ? { state: "checking" } : c)); // an old preview is not offered for a new link
    let stale = false;
    const delay = immediate.current ? 0 : CHECK_DELAY;
    immediate.current = false;
    const timer = setTimeout(() => {
      setCheck({ state: "checking" });
      api.previewYouTube(text).then(
        (preview) => { if (stale) return; setTitle(preview.title); setArtist(preview.artist); setCheck({ state: "ready", preview }); },
        (e) => { if (!stale) setCheck({ state: "error", message: e instanceof ApiError ? e.message : en.errors.generic }); },
      );
    }, delay);
    return () => { stale = true; clearTimeout(timer); };
  }, [link]);

  const pasteNow = (text: string) => { immediate.current = true; setLink(text); };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) pasteNow(text.trim());
    } catch {
      /* permission refused: typing still works */
    }
  };

  const preview = check.state === "ready" ? check.preview : null;
  const exists = preview?.existing_id != null;
  const add = async () => {
    if (!preview || exists || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const song = await api.addYouTubeSong(preview.video_id, title.trim() || undefined, artist.trim());
      setLink("");
      setCheck({ state: "idle" });
      onAdded(song);
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : en.errors.generic);
    } finally {
      setAdding(false);
    }
  };

  const kind = classifyInput(link);
  const playlistId = kind === "playlist" ? parsePlaylistId(link) : null;
  useEffect(() => { if (kind !== "search") setSearchFor(null); }, [kind, link]);
  const problem = check.state === "error" ? check.message : addError;
  const checking = check.state === "checking";
  return (
    <form autoComplete="off" className="yt-add" onSubmit={(e) => { e.preventDefault(); if (kind === "search") setSearchFor(link.trim()); else void add(); }}>
      <label className="field" style={{ marginBottom: 0 }}>
        <span>{en.library.youtubeLink}</span>
        <div className="inline yt-field">
          <input
            type="text" inputMode="url" aria-label={en.library.youtubeLink} {...noAutofill("youtube-link")} value={link} onChange={(e) => setLink(e.target.value)} onPaste={() => { immediate.current = true; }}
            placeholder={en.library.ytPlaceholder} aria-invalid={!!problem || undefined} aria-describedby={problem ? "yt-problem" : undefined} style={{ fontSize: 15 }}
          />
          {kind === "search" && <button type="submit" className="btn inverse" style={{ borderRadius: 10 }}>{en.library.ytSearch}</button>}
          {canPaste && kind !== "search" && (
            <button type="button" className="btn secondary" onClick={() => void paste()} disabled={checking} style={{ borderRadius: 10 }}>
              {checking ? <><span className="yt-spin" aria-hidden="true" />{en.library.ytChecking}</> : en.library.ytPaste}
            </button>
          )}
        </div>
        {!canPaste && checking && <small role="status">{en.library.ytChecking}…</small>}
        {problem && <small id="yt-problem" className="yt-problem" role="alert">{problem}</small>}
        {!problem && !preview && !checking && kind === "empty" && <small>{en.library.youtubeHelp}</small>}
        {kind === "search" && searchFor === null && <small>{en.library.ytSearchHint(link.trim())}</small>}
      </label>
      {kind === "spotifyTrack" && <SpotifyTrackImport key={link.trim()} link={link.trim()} onAdded={onAdded} onShow={onShow} />}
      {kind === "spotify" && <SpotifyPlaylistImport key={link.trim()} link={link.trim()} onDone={() => onPlaylistAdded?.()} onPaste={() => setListOpen(true)} />}
      {kind === "search" && searchFor !== null && <YouTubeSearch query={searchFor} onAdded={onAdded} onShow={onShow} />}
      {listOpen && <TrackListImport spotify={kind === "spotify"} onMade={() => onPlaylistAdded?.()} />}
      {!listOpen && kind !== "playlist" && kind !== "spotify" && kind !== "spotifyTrack" && <div><button type="button" className="btn quiet small" onClick={() => setListOpen(true)}>{en.library.tlOpen}</button></div>}
      {playlistId && <YouTubePlaylistImport key={playlistId} listId={playlistId} onAdded={() => onPlaylistAdded?.()} />}
      {preview && exists && (
        <div className="yt-exists" role="status">
          <span>{en.library.ytExists(preview.existing_title ?? preview.title)}</span>
          <button type="button" className="btn secondary small" onClick={() => onShow(preview.existing_title ?? preview.title)}>{en.library.ytShowIt}</button>
        </div>
      )}
      {preview && !exists && (
        <div className="yt-preview" data-phone={phone || undefined}>
          <img className="yt-thumb" src={youtubeThumb(preview.video_id)} alt="" width={phone ? 128 : 240} height={phone ? 72 : 135} />
          <div className="yt-fields">
            <div className="yt-channel">
              <span>{preview.channel}</span>
              {isTopicChannel(preview.channel) && <span className="dup-tag" title={en.library.albumTimingHelp}>{en.library.albumTiming}</span>}
            </div>
            <label className="field"><span>{en.library.ytTitle}</span><input type="text" {...noAutofill("youtube-title")} value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: 15 }} /></label>
            <label className="field"><span>{en.library.ytArtist}</span><input type="text" {...noAutofill("youtube-artist")} value={artist} onChange={(e) => setArtist(e.target.value)} style={{ fontSize: 15 }} /></label>
            <div><button type="submit" className="btn inverse" disabled={adding || !title.trim()}>{adding ? en.library.ytAdding : en.library.ytAddToLibrary}</button></div>
          </div>
        </div>
      )}
    </form>
  );
}
