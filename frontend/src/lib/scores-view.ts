import { en } from "../i18n/en";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The Scores search: case- and accent-insensitive, on title and artist; every word typed has to be found. */
export function scoresMatcher(query: string): (title: string, artist: string) => boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return () => true;
  return (title, artist) => {
    const hay = `${fold(title)} ${fold(artist)}`;
    return words.every((w) => hay.includes(w));
  };
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** The line over a board: "Top 10 of 18", "All 5 players", "Only you so far". */
export function boardHeading(players: number, shown: number, includesMe: boolean): string {
  if (players > shown) return en.scores.topOf(shown, players);
  if (players === 1 && includesMe) return en.scores.onlyYou;
  return en.scores.allPlayers(players);
}
