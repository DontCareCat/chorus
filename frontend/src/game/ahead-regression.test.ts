// Regression for "the ahead bonus always applies": the position sent with an answer is the playhead, which the controller
// moved BACK to the previous line (recovery) while the game waits. The server's rule (position < audio_start) then says "ahead".
import { expect, it } from "vitest";
import { PlaybackController } from "./playback-controller";
import type { SyncQuestion } from "./synchronization";
import { FakePlaybackEngine } from "./testing/fake-engine";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const serverSaysAhead = (position: number, audioStart: number, offset = 0) => position < audioStart + offset; // play.py / games.ts:259

it("an answer given while the game waits for it is not 'ahead'", async () => {
  const q: SyncQuestion = { id: 19, sequence: 19, startTime: 49.0, endTime: 52.1, recoveryTime: 45.3 };
  const engine = new FakePlaybackEngine();
  const c = new PlaybackController({ engine, getQuestions: () => [q], getAnswered: () => new Set(), fadeOutMs: 400, fadeInMs: 400 });
  engine.time = 47.0;
  c.play();
  await flush();
  for (let t = 0; t < 12000; t += 50) { engine.advance(50); c.tick(); await flush(); } // the line is sung, nobody answers
  expect(c.state.name).toBe("PAUSED_FOR_QUESTION");
  const position = c.positionForAnswer(); // what GamePage sends
  expect(engine.getCurrentTime()).toBeLessThan(q.startTime); // the controller rewound to the recovery point (45.3)
  expect(position).toBeGreaterThan(q.endTime);
  expect(serverSaysAhead(position, q.startTime)).toBe(false); 
});
