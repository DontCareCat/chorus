import { useEffect, useState } from "react";

export type Route =
  | { name: "library" }
  | { name: "song"; songId: number }
  | { name: "timing"; songId: number }
  | { name: "playlists" }
  | { name: "playlist"; playlistId: number }
  | { name: "game"; publicId: string }
  | { name: "settings" }
  | { name: "scores"; song: number | "all" | null }
  | { name: "dictionary" }
  | { name: "review" }
  | { name: "login"; signUp: boolean }
  | { name: "notfound" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "library" };
  if (path === "/settings") return { name: "settings" };
  if (path === "/scores") return { name: "scores", song: null };
  const scoresSong = /^\/scores\/(all|\d+)$/.exec(path);
  if (scoresSong) return { name: "scores", song: scoresSong[1] === "all" ? "all" : Number(scoresSong[1]) };
  if (path === "/dictionary") return { name: "dictionary" };
  if (path === "/dictionary/review") return { name: "review" };
  if (path === "/login") return { name: "login", signUp: false };
  if (path === "/register") return { name: "login", signUp: true };
  if (path === "/playlists") return { name: "playlists" };
  const playlist = /^\/playlists\/(\d+)$/.exec(path);
  if (playlist) return { name: "playlist", playlistId: Number(playlist[1]) };
  const timing = /^\/songs\/(\d+)\/timing$/.exec(path);
  if (timing) return { name: "timing", songId: Number(timing[1]) };
  const song = /^\/songs\/(\d+)$/.exec(path);
  if (song) return { name: "song", songId: Number(song[1]) };
  const game = /^\/games\/([0-9a-fA-F-]{8,64})$/.exec(path);
  if (game) return { name: "game", publicId: game[1]! };
  return { name: "notfound" };
}

export const paths = {
  library: () => "#/",
  settings: () => "#/settings",
  scores: () => "#/scores",
  scoresSong: (id: number | "all") => `#/scores/${id}`,
  dictionary: () => "#/dictionary",
  review: () => "#/dictionary/review",
  login: () => "#/login",
  register: () => "#/register",
  song: (id: number) => `#/songs/${id}`,
  timing: (id: number) => `#/songs/${id}/timing`,
  playlists: () => "#/playlists",
  playlist: (id: number) => `#/playlists/${id}`,
  game: (publicId: string) => `#/games/${publicId}`,
};

let blocker: ((to: string) => boolean) | null = null;
/** A page with unsaved work can refuse to be left: while it is registered, a change of the address (the browser's back button, a link) asks it first; returning true keeps the page where it is. */
export function blockNavigation(fn: (to: string) => boolean): () => void {
  blocker = fn;
  return () => { if (blocker === fn) blocker = null; };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    let current = location.hash;
    const on = () => {
      const to = location.hash;
      if (blocker && to !== current && blocker(to)) { history.replaceState(null, "", current || "#/"); return; } // stay; the page asks what to do
      current = to;
      setRoute(parseRoute(to));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
