import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { readClipboardText } from "../lib/clipboard";
import { ClearableInput } from "./ClearableInput";
import { Icon } from "./Icon";
import { classifyInput, cleanInput, spotifyKey, youtubeSearchUrl, isTopicChannel, parsePlaylistId, youtubeThumb } from "../lib/youtube-add";
import { SpotifyPlaylistImport } from "./SpotifyPlaylistImport";
import { SpotifyTrackImport } from "./SpotifyTrackImport";
import { TrackListImport } from "./TrackListImport";
import { YouTubePlaylistImport } from "./YouTubePlaylistImport";
import { api, ApiError } from "../services/api";
import type { SongDto, YouTubePreviewDto } from "../services/api";

/** Spotify playlists are on hold (one song at a time is too slow, and a playlist cannot be finished here yet): the flow is kept, switched off. */
const SPOTIFY_PLAYLISTS = false;
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
  const immediate = useRef(false);
  const [pasteFailed, setPasteFailed] = useState<false | "empty" | "refused">(false);
  const field = useRef<HTMLInputElement>(null);

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
      api.previewYouTube(cleanInput(text)).then(
        (preview) => { if (stale) return; setTitle(preview.title); setArtist(preview.artist); setCheck({ state: "ready", preview }); },
        (e) => { if (!stale) setCheck({ state: "error", message: e instanceof ApiError ? e.message : en.errors.generic }); },
      );
    }, delay);
    return () => { stale = true; clearTimeout(timer); };
  }, [link]);

  const pasteNow = (text: string) => { immediate.current = true; setLink(text); };
  const paste = async () => {
    try {
      const text = await readClipboardText();
      setPasteFailed(false);
      if (text.trim()) pasteNow(text.trim());
      else setPasteFailed("empty");
    } catch (e) {
      setPasteFailed(/no data|empty/i.test(String(e instanceof Error ? e.message : e)) ? "empty" : "refused"); // refused or not offered here: the field's own long-press Paste still works
      field.current?.focus();
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
  const problem = check.state === "error" ? check.message : addError;
  const checking = check.state === "checking";
  return (
    <form autoComplete="off" className="yt-add" onSubmit={(e) => { e.preventDefault(); if (kind === "search") window.open(youtubeSearchUrl("", link.trim()), "_blank", "noopener,noreferrer"); else void add(); }}>
      <label className="field" style={{ marginBottom: 0 }}>
        <span>{en.library.youtubeLink}</span>
        <div className="inline yt-field">
          <ClearableInput
            ref={field} type="text" aria-label={en.library.youtubeLink} {...noAutofill("youtube-link")} value={link} onValue={(v) => { setLink(v); setPasteFailed(false); }} onPaste={() => { immediate.current = true; }}
            placeholder={en.library.ytPlaceholder} aria-invalid={!!problem || undefined} aria-describedby={problem ? "yt-problem" : undefined} style={{ fontSize: 15 }}
          />
          <button type="button" className="icon-btn paste" onClick={() => void paste()} disabled={checking} aria-label={en.library.ytPasteLabel} title={en.library.ytPasteLabel}>
            {checking ? <span className="yt-spin" aria-hidden="true" /> : <Icon name="paste" />}
          </button>
        </div>
        {checking && <small role="status">{en.library.ytChecking}…</small>}
        {pasteFailed && <small role="status">{pasteFailed === "empty" ? en.library.ytPasteEmpty : en.library.ytPasteFailed}</small>}
        {problem && <small id="yt-problem" className="yt-problem" role="alert">{problem}</small>}
        {!problem && !preview && !checking && kind === "empty" && <small>{en.library.youtubeHelp}</small>}
        {kind === "search" && <small>{en.library.ytSearchHint(link.trim())}</small>}
        {kind === "search" && <div style={{ marginTop: 8 }}><button type="submit" className="btn inverse">{en.library.ytSearch}</button></div>}
      </label>
      {kind === "spotifyTrack" && <SpotifyTrackImport key={spotifyKey(link)} link={cleanInput(link)} onShow={onShow} />}
      {kind === "spotify" && (SPOTIFY_PLAYLISTS
        ? <SpotifyPlaylistImport key={spotifyKey(link)} link={cleanInput(link)} onDone={() => onPlaylistAdded?.()} onPaste={() => setListOpen(true)} />
        : <p className="muted" role="status">{en.library.spOnHold}</p>)}
      {listOpen && <TrackListImport spotify={kind === "spotify"} onMade={() => onPlaylistAdded?.()} />}
      {!listOpen && kind !== "playlist" && (kind !== "spotify" || !SPOTIFY_PLAYLISTS) && kind !== "spotifyTrack" && <div><button type="button" className="btn quiet small" onClick={() => setListOpen(true)}>{en.library.tlOpen}</button></div>}
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
