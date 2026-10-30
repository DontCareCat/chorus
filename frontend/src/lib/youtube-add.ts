export type AddTab = "youtube" | "files" | "folder";
export const ADD_TABS: readonly AddTab[] = ["youtube", "files", "folder"];
const KEY = "chorus-add-tab";

/** The tab of the Add music panel used last (browser storage may be blocked or hold anything). */
export function readAddTab(): AddTab | null {
  try {
    const v = localStorage.getItem(KEY);
    return ADD_TABS.find((t) => t === v) ?? null;
  } catch {
    return null;
  }
}

export function writeAddTab(tab: AddTab): void {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    /* blocked: the tab is just not remembered */
  }
}

/** The tab to open: the remembered one, or YouTube first; YouTube is skipped while it is switched off. */
export function startTab(youtubeOn: boolean): AddTab {
  const t = readAddTab();
  if (t && (t !== "youtube" || youtubeOn)) return t;
  return youtubeOn ? "youtube" : "files";
}

export const youtubeThumb = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
export const isTopicChannel = (channel: string | null | undefined): boolean => /- topic$/i.test(channel ?? "");

/** The id of a playlist link (youtube.com/playlist?list=…); a video link that merely sits in a playlist is a video. */
export function parsePlaylistId(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!text.includes("://")) text = `https://${text}`;
  try {
    const u = new URL(text);
    const host = u.hostname.toLowerCase();
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return null;
    if (u.pathname.replace(/\/+$/, "") !== "/playlist") return null;
    const id = u.searchParams.get("list");
    return id && /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Videos asked of the server in one call. */
export const IMPORT_BATCH = 20;

/** The id of a Spotify playlist link (open.spotify.com/playlist/… or spotify:playlist:…). */
export function parseSpotifyPlaylistId(input: string): string | null {
  const text = input.trim();
  const uri = /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return uri[1]!;
  try {
    const u = new URL(text.includes("://") ? text : `https://${text}`);
    if (!["open.spotify.com", "play.spotify.com"].includes(u.hostname.toLowerCase())) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const rest = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    return rest[0] === "playlist" && /^[A-Za-z0-9]{22}$/.test(rest[1] ?? "") ? rest[1]! : null;
  } catch {
    return null;
  }
}

/** Where to look for a track on YouTube (a normal search page: the person picks the video and pastes its link). */
export const youtubeSearchUrl = (artist: string, title: string): string => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title}`.trim())}`;

/** The id of a Spotify song link (open.spotify.com/track/… or spotify:track:…). */
export function parseSpotifyTrackId(input: string): string | null {
  const text = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return uri[1]!;
  try {
    const u = new URL(text.includes("://") ? text : `https://${text}`);
    if (!["open.spotify.com", "play.spotify.com"].includes(u.hostname.toLowerCase())) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const rest = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    return rest[0] === "track" && /^[A-Za-z0-9]{22}$/.test(rest[1] ?? "") ? rest[1]! : null;
  } catch {
    return null;
  }
}

export type InputKind = "empty" | "video" | "playlist" | "spotify" | "spotifyTrack" | "link" | "search";

/** The pasted text without the brackets, quotes and full stop that a message app wraps around a link. */
export function cleanInput(input: string): string {
  const t = input.trim();
  const wrapped = /^[<(\["'“‘]+(.*?)[>)\]"'”’]+$/.exec(t);
  const inner = wrapped && /^(?:[a-z][a-z0-9+.-]*:|www\.|(?:m|music)\.)/i.test(wrapped[1]!) ? wrapped[1]! : t;
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i.test(inner) ? inner.replace(/[.,;:!?]+$/, "") : inner;
}

/** What the one field of Add music was given: a YouTube video, a YouTube playlist, a Spotify playlist, another link, or words to search for. */
export function classifyInput(input: string): InputKind {
  const text = cleanInput(input);
  if (!text) return "empty";
  if (parsePlaylistId(text)) return "playlist";
  if (parseSpotifyPlaylistId(text)) return "spotify";
  if (parseSpotifyTrackId(text)) return "spotifyTrack";
  if (/^spotify:/i.test(text)) return "link";
  const looksLikeLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|open\.spotify\.com)(\/|$)/i.test(text) || /^[^\s/]+\.[a-z]{2,}\/\S*$/i.test(text);
  if (!looksLikeLink) return "search";
  return /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(text) ? "video" : "link";
}

/** What identifies a Spotify link (its id), so editing the tracking parameters does not read the page again. */
export const spotifyKey = (link: string): string => parseSpotifyPlaylistId(cleanInput(link)) ?? parseSpotifyTrackId(cleanInput(link)) ?? link.trim();

/** Does the video found look like this song? (the title has the song's title, and the artist is in the title or the channel) */
export function looksRight(track: { title: string; artist: string }, hit: { title: string; channel: string }): boolean {
  const words = (x: string, ofTrack = false) => x.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(ofTrack ? /\([^)]*\)|\[[^\]]*\]|\s-\s.*$/g : /$^/, " ").match(/[\p{L}\p{N}]+/gu) ?? []; // a track's "(Remastered)" is not looked for in the video
  const hitWords = new Set(words(`${hit.title} ${hit.channel}`));
  const titleWords = words(track.title, true);
  const artistWords = words(track.artist.split(",")[0] ?? "");
  const has = (ws: string[]) => ws.length > 0 && ws.every((w) => hitWords.has(w));
  const hasArtist = (ws: string[]) => ws.every((w) => hitWords.has(w) || (w.length >= 4 && [...hitWords].some((h) => h.startsWith(w)))); // a channel like "BeyoncéVEVO"
  return has(titleWords) && (artistWords.length === 0 || hasArtist(artistWords));
}
