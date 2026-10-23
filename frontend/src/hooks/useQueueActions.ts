import { useCallback } from "react";
import { announce, useQueue } from "./useQueue";
import { en } from "../i18n/en";
import { progressiveLevel } from "../lib/progressive";
import * as Q from "../lib/queue";
import { announceArrival } from "../lib/handoff";
import type { Arrival } from "../lib/handoff";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { QueueLevel } from "../lib/queue";
import type { SongDto } from "../services/api";

let defaultLevel: Promise<QueueLevel> | null = null;
/** The difficulty new queue entries get (Settings > Play queue); asked once per page load. */
const level = (): Promise<QueueLevel> => (defaultLevel ??= api.settings().then((s) => s.default_queue_difficulty, () => "progressive" as QueueLevel));
export const forgetQueueLevel = (): void => { defaultLevel = null; };

/** Add songs to the queue, start a queue (in order or shuffled): what the menus, swipes and the Play all / Shuffle buttons call. */
export function useQueueActions() {
  const store = useQueue();
  const add = useCallback(async (ids: number[]) => {
    const difficulty = await level();
    const r = store.add(ids, { difficulty, mode: "choice" });
    if (r.added === 0 && ids.length > 0) announce(en.queue.already);
    else announce(en.queue.addedToast(r.added, Q.upcoming(store.snapshot()).length));
  }, [store]);
  const play = useCallback(async (songs: SongDto[], shuffle: boolean) => {
    const usable = songs.filter((s) => s.available && s.lyrics_status === "found");
    if (usable.length === 0) { announce(en.queue.skippedNote(songs.length)); return; }
    store.start(usable.map((s) => s.id), { difficulty: await level(), mode: "choice" }, shuffle);
    if (usable.length < songs.length) announce(en.queue.skippedNote(songs.length - usable.length));
  }, [store]);
  /** Start the next song of the queue with its own difficulty and mode, move the queue on, and open the game. Returns the error text when it cannot.
 *  `arrival` makes the new game start playing by itself (with a fade-in); `beforeNavigate` runs just before the page changes. */
  const playNext = useCallback(async (opts: { arrival?: Arrival; beforeNavigate?: () => void } = {}): Promise<string | null> => {
    const next = Q.next(store.snapshot());
    if (!next) return null;
    try {
      const lvl = next.difficulty === "progressive" ? progressiveLevel(await api.myGames(), next.songId, next.mode) : next.difficulty;
      const g = await api.createGame(next.songId, lvl, next.mode);
      store.set(Q.withPlaying(Q.advance(store.snapshot()), g.public_id));
      opts.beforeNavigate?.(); // the page that is leaving lets its song fade out
      if (opts.arrival) announceArrival(opts.arrival); // and the new one knows how to start
      location.hash = paths.game(g.public_id);
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : en.errors.generic;
    }
  }, [store]);
  return { add, play, playNext };
}
