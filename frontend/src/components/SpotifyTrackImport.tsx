import { useEffect, useState } from "react";
import { en } from "../i18n/en";
import { youtubeSearchUrl } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";
import type { SongDto, SpotifyTrackDto } from "../services/api";
import { YouTubeSearch } from "./YouTubeSearch";

/** A Spotify song link: read from Spotify, then looked for on YouTube (the videos found are added under the Spotify song's own title and artist). */
export function SpotifyTrackImport({ link, onAdded, onShow }: { link: string; onAdded: (song: SongDto) => void; onShow: (title: string) => void }) {
  const [track, setTrack] = useState<SpotifyTrackDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    setTrack(null);
    setError(null);
    api.spotifyTrack(link).then(
      (t) => { if (!gone) setTrack(t); },
      (e) => { if (!gone) setError(e instanceof ApiError ? e.message : en.errors.generic); },
    );
    return () => { gone = true; };
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
          <YouTubeSearch query={`${first} ${track.title}`.trim()} onAdded={onAdded} onShow={onShow} names={{ title: track.title, artist: first }} />
          <a href={youtubeSearchUrl(first, track.title)} target="_blank" rel="noreferrer">{en.library.ytSearchOnYouTube}</a>
        </>
      )}
    </div>
  );
}
