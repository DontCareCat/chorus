import { useEffect, useState } from "react";

export type Route =
  | { name: "library" }
  | { name: "song"; songId: number }
  | { name: "playlists" }
  | { name: "playlist"; playlistId: number }
  | { name: "game"; publicId: string }
  | { name: "settings" }
  | { name: "scores" }
  | { name: "dictionary" }
  | { name: "review" }
  | { name: "login"; signUp: boolean }
  | { name: "notfound" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "library" };
  if (path === "/settings") return { name: "settings" };
  if (path === "/scores") return { name: "scores" };
  if (path === "/dictionary") return { name: "dictionary" };
  if (path === "/dictionary/review") return { name: "review" };
  if (path === "/login") return { name: "login", signUp: false };
  if (path === "/register") return { name: "login", signUp: true };
  if (path === "/playlists") return { name: "playlists" };
  const playlist = /^\/playlists\/(\d+)$/.exec(path);
  if (playlist) return { name: "playlist", playlistId: Number(playlist[1]) };
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
  dictionary: () => "#/dictionary",
  review: () => "#/dictionary/review",
  login: () => "#/login",
  register: () => "#/register",
  song: (id: number) => `#/songs/${id}`,
  playlists: () => "#/playlists",
  playlist: (id: number) => `#/playlists/${id}`,
  game: (publicId: string) => `#/games/${publicId}`,
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
