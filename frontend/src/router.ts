import { useEffect, useState } from "react";

export type Route =
  | { name: "library" }
  | { name: "song"; songId: number }
  | { name: "game"; publicId: string }
  | { name: "settings" }
  | { name: "login" }
  | { name: "notfound" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "library" };
  if (path === "/settings") return { name: "settings" };
  if (path === "/login") return { name: "login" };
  const song = /^\/songs\/(\d+)$/.exec(path);
  if (song) return { name: "song", songId: Number(song[1]) };
  const game = /^\/games\/([0-9a-fA-F-]{8,64})$/.exec(path);
  if (game) return { name: "game", publicId: game[1]! };
  return { name: "notfound" };
}

export const paths = {
  library: () => "#/",
  settings: () => "#/settings",
  login: () => "#/login",
  song: (id: number) => `#/songs/${id}`,
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
