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
    let engine: YouTubePlaybackEngine | null = null;
    const player = new YT.Player(mount, {
      videoId,
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, controls: 1, rel: 0, fs: 1, disablekb: 0, origin: location.origin.startsWith("http") ? location.origin : undefined },
      events: {
        onReady: () => { engine = new YouTubePlaybackEngine(player); resolve(engine); },
        onStateChange: (e: { data: number }) => engine?.handleState(e.data),
        onError: (e: { data: number }) => (engine ? engine.handleError(e.data) : reject(new Error(youtubeErrorMessage(e.data)))),
      },
    });
  });
}
