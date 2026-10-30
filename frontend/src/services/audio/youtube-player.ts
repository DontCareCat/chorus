import { YouTubePlaybackEngine, youtubeErrorMessage } from "./youtube-engine";
import type { YtPlayerLike } from "./youtube-engine";

interface YtGlobal {
  Player: new (el: HTMLElement | string, options: Record<string, unknown>) => YtPlayerLike;
}
declare global {
  interface Window { YT?: YtGlobal; onYouTubeIframeAPIReady?: () => void }
}

let apiReady: Promise<YtGlobal> | null = null;

/** Load YouTube's IFrame API once. */
export function loadYouTubeApi(): Promise<YtGlobal> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiReady ??= new Promise<YtGlobal>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT!); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { apiReady = null; reject(new Error("YouTube's player could not be loaded. Are you online?")); };
    document.head.appendChild(s);
  });
  return apiReady;
}

/** A YouTube player inside `host`, paused on the video, and the engine that drives it. */
export async function createYouTubeEngine(host: HTMLElement, videoId: string): Promise<YouTubePlaybackEngine> {
  const YT = await loadYouTubeApi();
  const mount = document.createElement("div");
  host.replaceChildren(mount);
  return new Promise<YouTubePlaybackEngine>((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error("YouTube's player did not start. Is something blocking youtube.com?")), 20_000);
    let engine: YouTubePlaybackEngine | null = null;
    const player = new YT.Player(mount, {
      videoId,
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, controls: 1, rel: 0, fs: 1, disablekb: 0, origin: location.origin.startsWith("http") ? location.origin : undefined },
      events: {
        onReady: () => { clearTimeout(giveUp); engine = new YouTubePlaybackEngine(player); resolve(engine); },
        onStateChange: (e: { data: number }) => engine?.handleState(e.data),
        onError: (e: { data: number }) => (engine ? engine.handleError(e.data) : reject(new Error(youtubeErrorMessage(e.data)))),
      },
    });
  });
}

/**
 * The video ids of a public playlist (the first 200), read by YouTube's own player: it is shown in `host` (200 px high, paused) while it
 * reads, as every embedded player is. Rejects when the playlist is private or does not exist.
 */
export async function loadPlaylistVideoIds(host: HTMLElement, listId: string, timeoutMs = 20_000): Promise<string[]> {
  const YT = await loadYouTubeApi();
  const mount = document.createElement("div");
  host.replaceChildren(mount);
  return new Promise<string[]>((resolve, reject) => {
    let poll: ReturnType<typeof setInterval> | undefined;
    const finish = (fn: () => void) => { clearTimeout(giveUp); clearInterval(poll); try { player.destroy(); } catch { /* gone */ } host.replaceChildren(); fn(); };
    const giveUp = setTimeout(() => finish(() => reject(new Error("YouTube did not give the playlist. Is it public?"))), timeoutMs);
    const player = new YT.Player(mount, {
      width: "100%", height: "100%",
      playerVars: { listType: "playlist", list: listId, playsinline: 1, controls: 1, rel: 0, origin: location.origin.startsWith("http") ? location.origin : undefined },
      events: {
        onReady: () => {
          poll = setInterval(() => {
            const ids = (player as unknown as { getPlaylist?: () => string[] | null }).getPlaylist?.();
            if (ids && ids.length) finish(() => resolve(ids));
          }, 200);
        },
        onError: (e: { data: number }) => finish(() => reject(new Error(youtubeErrorMessage(e.data)))),
      },
    });
  });
}
