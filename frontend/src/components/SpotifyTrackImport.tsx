import { useEffect, useState } from "react";
import { en } from "../i18n/en";
import { youtubeSearchUrl } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";
import type { SpotifyTrackDto } from "../services/api";

/** A Spotify song link: read from Spotify; if the song is in the library it says so, otherwise it links to the YouTube search for it. */
export function SpotifyTrackImport({ link, onShow }: { link: string; onShow: (title: string) => void }) {
  const [track, setTrack] = useState<SpotifyTrackDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    setTrack(null);
    setError(null);
    const wait = setTimeout(() => api.spotifyTrack(link).then(
      (t) => { if (!gone) setTrack(t); },
      (e) => { if (!gone) setError(e instanceof ApiError ? e.message : en.errors.generic); },
    ), 500); // typing a link does not read a page for every letter
    return () => { gone = true; clearTimeout(wait); };
  }, [link]);

  if (error) return <p className="yt-problem" role="alert">{error}</p>;
  if (!track) return <p className="muted" role="status">{en.library.stReading}</p>;
  const first = track.artist.split(",")[0]!.trim();
  return (
    <div className="yt-playlist sp-playlist">
      <p><strong>{en.library.stFound(track.artist, track.title)}</strong></p>
      {track.song_id !== null ? (
        <div className="yt-exists" role="status">
          <span>{en.library.stHave(track.song_title ?? track.title)}</span>
          <button type="button" className="btn secondary small" onClick={() => onShow(track.song_title ?? track.title)}>{en.library.ytShowIt}</button>
        </div>
      ) : (
        <>
          <p className="muted">{en.library.stPick}</p>
          <div><a className="btn inverse" href={youtubeSearchUrl(first, track.title)} target="_blank" rel="noreferrer">{en.library.spFind}</a></div>
        </>
      )}
    </div>
  );
}
