import type { GameEngine } from "../services/audio/engine";

/**
 * What one game page tells the next when a queue moves on (guide section 23): how long the new song fades in, and that it starts by itself.
 * Read in render and cleared after mounting, so React's double render in development sees it twice.
 */
export interface Arrival { fadeMs: number; autostart: boolean }
let pending: (Arrival & { at: number }) | null = null;

export const announceArrival = (a: Arrival): void => { pending = { ...a, at: Date.now() }; };
export const peekArrival = (): Arrival | null => (pending && Date.now() - pending.at < 20_000 ? pending : null);
export const clearArrival = (): void => { pending = null; };

/**
 * The page that is going away lets its song fade out on its own (the <audio> element lives outside React's tree so it keeps playing),
 * then stops and removes it. A timer makes sure it goes even if the fade never reports back.
 */
export function fadeOutAndRelease(engine: GameEngine, audio: HTMLAudioElement, ms: number): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { engine.dispose(); } catch { /* already gone */ }
    audio.pause();
    audio.removeAttribute("src");
    audio.remove();
  };
  void engine.fadeOut(ms).then(finish, finish);
  setTimeout(finish, ms + 1500);
}
