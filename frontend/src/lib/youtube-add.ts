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
