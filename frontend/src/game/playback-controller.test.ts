import { beforeEach, describe, expect, it } from "vitest";
import { PlaybackController } from "./playback-controller";
import type { SyncQuestion } from "./synchronization";
import { FakePlaybackEngine } from "./testing/fake-engine";

// Lines: 17 (42.5–45.2), 18 (45.3–48.7), 19 (49.0–52.1), 20 (53–56). Questions on 19 and 20 (and an early 16).
const Q = (id: number, start: number, end: number, recovery: number): SyncQuestion => ({
  id, sequence: id, startTime: start, endTime: end, recoveryTime: recovery,
});
const Q16 = Q(16, 30, 33, 28);
const Q19 = Q(19, 49.0, 52.1, 45.3);
const Q20 = Q(20, 53.0, 56.0, 49.0);

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface Rig {
  engine: FakePlaybackEngine;
  c: PlaybackController;
  answered: Set<number>;
  questions: SyncQuestion[];
  states: string[];
  answer: (id: number) => void;
  /** advance time in 50 ms steps, polling like the real timer, flushing microtasks each step */
  run: (ms: number) => Promise<void>;
}

function rig(questions: SyncQuestion[], opts: { gating?: boolean } = {}): Rig {
  const engine = new FakePlaybackEngine();
  const answered = new Set<number>();
  const states: string[] = [];
  const c = new PlaybackController({
    engine, getQuestions: () => questions, getAnswered: () => answered, fadeOutMs: 400, fadeInMs: 400,
    gating: opts.gating, onChange: (s) => states.push(s.name),
  });
  return {
    engine, c, answered, questions, states,
    answer: (id) => { answered.add(id); c.notifyAnswered(id); },
    run: async (ms) => {
      for (let t = 0; t < ms; t += 50) {
        engine.advance(50);
        c.tick();
        await flush();
      }
    },
  };
}

let r: Rig;
beforeEach(() => {
  r = rig([Q19, Q20]);
});

/** Start playing at `time` and let the audio run into an overdue state for Q19. */
async function overrun(rg: Rig, from = 54.9) {
  rg.engine.time = from;
  rg.c.play();
  await flush();
  await rg.run(300); // 55.2 → overdue
}

describe("normal playback", () => {
  it("does not interfere while the user is ahead of the audio", async () => {
    r.engine.time = 10;
    r.c.play();
    await r.run(2000);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.count("fadeOut")).toBe(0);
    expect(r.engine.volume).toBe(1);
  });

  it("exactly 3 s past the question end: no recovery; just past it: recovery", async () => {
    r.engine.time = 54.9; // 52.1 + 3 = 55.1
    r.c.play();
    await flush();
    r.engine.time = 55.1;
    r.c.tick();
    expect(r.c.state.name).toBe("PLAYING");
    r.engine.time = 55.11;
    r.c.tick();
    expect(r.c.state.name).toBe("FADING_OUT");
  });
});

describe("full recovery cycle", () => {
  it("fade out → pause → seek to previous line → wait → answer → fade in → play", async () => {
    await overrun(r);
    expect(r.c.state.name).toBe("FADING_OUT");
    expect(r.engine.volume).toBeLessThan(1);
    await r.run(500); // fade completes
    expect(r.engine.volume).toBe(0);
    expect(r.engine.playing).toBe(false);
    expect(r.engine.time).toBe(45.3); // previous line's start, not 52.1 - 3
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.c.state.blockingId).toBe(19);

    const t = r.engine.time;
    await r.run(1000); // waiting for the user: audio stays put
    expect(r.engine.time).toBe(t);
    expect(r.engine.playing).toBe(false);

    r.answer(19);
    expect(r.c.state.name).toBe("FADING_IN");
    await flush();
    expect(r.engine.playing).toBe(true);
    await r.run(500);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.volume).toBe(1);
    expect(r.c.state.blockingId).toBeNull();
    expect(r.states).toEqual(["PLAYING", "FADING_OUT", "SEEKING", "PAUSED_FOR_QUESTION", "FADING_IN", "PLAYING"]);
  });

  it("the process repeats for later questions (Q19 answered, Q20 then overruns)", async () => {
    await overrun(r);
    await r.run(500);
    r.answer(19);
    await r.run(500);
    expect(r.c.state.name).toBe("PLAYING");
    r.engine.time = 59.1; // Q20 ends 56.0 → deadline 59.0
    await r.run(100);
    expect(r.c.state.name).toBe("FADING_OUT");
    await r.run(500);
    expect(r.engine.time).toBe(49.0); // Q20's recovery position
    expect(r.c.state.blockingId).toBe(20);
  });

  it("quiz state is never touched by recovery", async () => {
    await overrun(r);
    await r.run(600);
    expect([...r.answered]).toEqual([]);
  });
});

describe("idempotent recovery", () => {
  it("repeated ticks while recovering start no second fade or seek", async () => {
    await overrun(r);
    for (let i = 0; i < 20; i++) r.c.tick();
    r.engine.time = 80;
    for (let i = 0; i < 20; i++) r.c.tick();
    await r.run(600);
    expect(r.engine.count("fadeOut")).toBe(1);
    expect(r.engine.count("seek:")).toBe(1);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    for (let i = 0; i < 20; i++) r.c.tick(); // paused: ticks are ignored
    expect(r.engine.count("fadeOut")).toBe(1);
  });
});

describe("answers during recovery", () => {
  it("answer during FADING_OUT cancels the fade, fades back in, and does not seek", async () => {
    await overrun(r);
    await r.run(150); // fade partly done
    const v = r.engine.volume;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    r.answer(19);
    expect(r.c.state.name).toBe("FADING_IN");
    expect(r.engine.volume).toBe(v); // no jump
    await r.run(600);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.volume).toBe(1);
    expect(r.engine.count("seek:")).toBe(0);
    expect(r.engine.playing).toBe(true);
  });

  it("answer while the seek is still running: resumes as soon as the seek completes", async () => {
    r.engine.holdSeeks = true;
    await overrun(r);
    await r.run(500);
    expect(r.c.state.name).toBe("SEEKING");
    r.answer(19);
    expect(r.c.state.name).toBe("SEEKING");
    r.engine.releaseSeek();
    await flush();
    expect(r.c.state.name).toBe("FADING_IN");
    expect(r.engine.time).toBe(45.3);
    await r.run(500);
    expect(r.c.state.name).toBe("PLAYING");
  });

  it("answering a NON-blocking question while paused does not resume", async () => {
    await overrun(r);
    await r.run(600);
    r.answer(20);
    await r.run(500);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.engine.playing).toBe(false);
    r.answer(19);
    expect(r.c.state.name).toBe("FADING_IN");
  });

  it("answering a question that is not the blocking one during FADING_OUT is ignored", async () => {
    r = rig([Q16, Q19, Q20]);
    r.engine.time = 36.9; // Q16 ends 33 → overdue at 36.0
    r.c.play();
    await flush();
    await r.run(100);
    expect(r.c.state.blockingId).toBe(16);
    r.answer(20);
    expect(r.c.state.name).toBe("FADING_OUT");
    expect(r.c.state.blockingId).toBe(16);
  });

  it("when the next unanswered question is overdue too, recovery continues with it", async () => {
    r = rig([Q19, Q20]);
    r.engine.time = 59.9; // both overdue: Q19 (55.1) and Q20 (59.0)
    r.c.play();
    await flush();
    await r.run(100);
    expect(r.c.state.blockingId).toBe(19);
    r.answer(19);
    expect(r.c.state.name).toBe("FADING_OUT");
    expect(r.c.state.blockingId).toBe(20);
    await r.run(500);
    expect(r.engine.time).toBe(49.0); // Q20's recovery position
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.engine.count("fadeOut")).toBe(1);
  });
});

describe("fade interruption", () => {
  it("overrun again during FADING_IN fades out from the current gain without a jump", async () => {
    r = rig([Q19, Q20]);
    r.engine.time = 55.5;
    r.c.play();
    await flush();
    await r.run(500); // → paused for Q19 at 45.3
    r.answer(19);
    await flush();
    await r.run(100); // fade-in underway
    const v = r.engine.volume;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    expect(r.c.state.name).toBe("FADING_IN");
    r.engine.time = 70; // scrubbed far ahead → Q20 overdue
    r.c.tick();
    expect(r.c.state.name).toBe("FADING_OUT");
    expect(r.engine.volume).toBe(v);
    await r.run(600);
    expect(r.engine.volume).toBe(0);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.c.state.blockingId).toBe(20);
  });

  it("gain always stays within [0, 1] through a whole cycle", async () => {
    const seen: number[] = [];
    await overrun(r);
    for (let i = 0; i < 40; i++) {
      await r.run(50);
      seen.push(r.engine.volume);
      if (r.c.state.name === "PAUSED_FOR_QUESTION") r.answer(19);
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });
});

describe("seeking by the player", () => {
  it("backwards is always allowed", async () => {
    r.engine.time = 54;
    r.c.play();
    await r.run(100);
    const o = await r.c.userSeek(3);
    expect(o).toEqual({ applied: true, clamped: false });
    await r.run(500);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.count("fadeOut")).toBe(0);
  });

  it("forwards past an open question cannot skip it: it lands at that question's line, no recovery, no fade", async () => {
    r.engine.time = 10;
    r.c.play();
    await r.run(200);
    const o = await r.c.userSeek(120);
    expect(o).toEqual({ applied: true, clamped: true });
    expect(r.engine.time).toBe(49); // Q19 starts at 49
    await r.run(200);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.count("fadeOut")).toBe(0);
  });

  it("inside the open question's window is allowed as asked", async () => {
    r.engine.time = 10;
    r.c.play();
    await flush();
    expect(await r.c.userSeek(54)).toEqual({ applied: true, clamped: false }); // ≤ 52.1 + 3
    expect(r.engine.time).toBe(54);
  });

  it("when the audio is already inside the open line, a click further ahead leaves it where it is", async () => {
    r.engine.time = 50;
    r.c.play();
    await flush();
    expect(await r.c.userSeek(100)).toEqual({ applied: false, clamped: true });
    expect(r.engine.time).toBe(50);
    expect(r.engine.count("seek:")).toBe(0);
  });

  it("repeated clicks past the question are harmless and never trigger the fade-out/rewind cycle", async () => {
    r.engine.time = 10;
    r.c.play();
    await r.run(100);
    for (const t of [60, 100, 119, 60, 120]) {
      await r.c.userSeek(t);
      await r.run(150);
    }
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.count("fadeOut")).toBe(0);
    expect(r.engine.time).toBeLessThan(55.1); // never past the deadline
  });

  it("while waiting for an answer the audio stays near the question: forward clicks are limited, backward ones allowed", async () => {
    await waiting(r); // paused at 45.3
    expect(await r.c.userSeek(100)).toEqual({ applied: true, clamped: true });
    expect(r.engine.time).toBe(49);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(await r.c.userSeek(20)).toEqual({ applied: true, clamped: false });
    expect(r.engine.time).toBe(20);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
  });

  it("once the question is answered nothing limits the player", async () => {
    r.answered.add(19).add(20);
    r.engine.time = 10;
    r.c.play();
    await flush();
    expect(await r.c.userSeek(200)).toEqual({ applied: true, clamped: false });
  });

  it("player seeks are ignored while the game rewinds itself, so they cannot fight its own seek", async () => {
    await overrun(r);
    expect(r.c.state.name).toBe("FADING_OUT");
    expect(await r.c.userSeek(5)).toEqual({ applied: false, clamped: false });
    r.engine.holdSeeks = true;
    await r.run(500); // fade done → SEEKING with a pending seek to 45.3
    expect(r.c.state.name).toBe("SEEKING");
    const seeks = r.engine.count("seek:");
    expect(await r.c.userSeek(5)).toEqual({ applied: false, clamped: false });
    expect(r.engine.count("seek:")).toBe(seeks);
    r.engine.releaseSeek();
    await flush();
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.engine.time).toBe(45.3); // exactly where the game put it
  });

  it("a failed seek is an error", async () => {
    r.engine.time = 10;
    r.c.play();
    await flush();
    r.engine.failNextSeek = true;
    await r.c.userSeek(20);
    expect(r.c.state.name).toBe("ERROR");
  });

  it("free play never limits", async () => {
    const f = rig([], { gating: false });
    f.engine.time = 10;
    f.c.play();
    await flush();
    expect(await f.c.userSeek(200)).toEqual({ applied: true, clamped: false });
  });
});

describe("end of audio", () => {
  it("ended with an unanswered question → recover without fading (nothing is playing)", async () => {
    r.engine.duration = 53; // shorter than Q19 end (52.1) + 3
    r.engine.time = 52.5;
    r.c.play();
    await flush();
    r.engine.advance(1000);
    r.c.notifyEnded();
    await flush();
    expect(r.engine.count("fadeOut")).toBe(0);
    expect(r.engine.time).toBe(45.3);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    r.answer(19);
    await flush();
    expect(r.engine.playing).toBe(true);
    await r.run(500);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.volume).toBe(1);
  });

  it("ended with everything answered → IDLE", async () => {
    r.answered.add(19).add(20);
    r.c.play();
    await flush();
    r.c.notifyEnded();
    expect(r.c.state.name).toBe("IDLE");
  });
});

describe("errors", () => {
  it("failed seek → ERROR", async () => {
    r.engine.failNextSeek = true;
    await overrun(r);
    await r.run(500);
    expect(r.c.state.name).toBe("ERROR");
    expect(r.c.state.error).toContain("seek failed");
  });

  it("rejected play (autoplay policy) → ERROR, and PLAY again retries", async () => {
    r.engine.rejectNextPlay = true;
    r.c.play();
    await flush();
    expect(r.c.state.name).toBe("ERROR");
    expect(r.c.state.error).toContain("play_rejected");
    r.c.play();
    await flush();
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.playing).toBe(true);
  });

  it("engine error → ERROR with the audio paused", async () => {
    r.c.play();
    await flush();
    r.c.notifyError("decode error");
    expect(r.c.state.name).toBe("ERROR");
    expect(r.engine.playing).toBe(false);
  });
});

describe("user pause and playback rate", () => {
  it("user pause / play; no gating while paused", async () => {
    r.engine.time = 10;
    r.c.play();
    await flush();
    r.c.pause();
    expect(r.c.state.name).toBe("PAUSED");
    r.engine.time = 200;
    r.c.tick();
    expect(r.c.state.name).toBe("PAUSED");
    r.c.play();
    expect(r.c.state.name).toBe("PLAYING");
  });

  it("uses the engine's real position at playbackRate 2", async () => {
    r.engine.rate = 2;
    r.engine.time = 54;
    r.c.play();
    await flush();
    await r.run(600); // 1.2 s of audio per 0.6 s wall clock → 55.2
    expect(r.c.state.name).not.toBe("PLAYING");
  });
});

describe("free play (unsynchronized lyrics)", () => {
  it("never gates, fades or rewinds", async () => {
    const f = rig([], { gating: false });
    f.engine.time = 500;
    f.c.play();
    await f.run(2000);
    expect(f.c.state.name).toBe("PLAYING");
    expect(f.engine.count("fadeOut")).toBe(0);
    f.c.notifyEnded();
    expect(f.c.state.name).toBe("IDLE");
  });
});

describe("stale async completions", () => {
  /** An engine that (wrongly) reports a superseded fade as completed, long after it was replaced. */
  class SloppyEngine extends FakePlaybackEngine {
    resolvers: Array<(done: boolean) => void> = [];
    override cancelFade(): void {} // never settles the old promise itself
    override fadeOut(): Promise<boolean> {
      return new Promise((res) => this.resolvers.push(res));
    }
    override fadeIn(): Promise<boolean> {
      return new Promise((res) => this.resolvers.push(res));
    }
  }

  it("a late 'done' from a superseded fade-out does not end the new fade-in early", async () => {
    const engine = new SloppyEngine();
    const answered = new Set<number>();
    const c = new PlaybackController({ engine, getQuestions: () => [Q19], getAnswered: () => answered });
    engine.time = 55.5;
    c.play();
    await flush();
    c.tick();
    expect(c.state.name).toBe("FADING_OUT");
    answered.add(19);
    c.notifyAnswered(19);
    expect(c.state.name).toBe("FADING_IN");
    engine.resolvers[0]!(true); // the OLD fade-out finishes late
    await flush();
    expect(c.state.name).toBe("FADING_IN"); // must not jump to PLAYING
    engine.resolvers[1]!(true); // the real fade-in finishes
    await flush();
    expect(c.state.name).toBe("PLAYING");
  });

  it("a late seek completion after an error/reset does not resurrect the recovery", async () => {
    const e = new FakePlaybackEngine();
    e.holdSeeks = true;
    const answered = new Set<number>();
    const c = new PlaybackController({ engine: e, getQuestions: () => [Q19], getAnswered: () => answered, fadeOutMs: 0 });
    e.time = 55.5;
    c.play();
    await flush();
    c.tick();
    await flush();
    expect(c.state.name).toBe("SEEKING");
    c.notifyError("device lost");
    c.play(); // user retries; state is PLAYING again
    e.releaseSeek(); // the seek from the abandoned recovery finally completes
    await flush();
    expect(c.state.name).toBe("PLAYING");
  });
});

/** Overrun → fully waiting for Q19 (position at its recovery point 45.3, silent, paused). */
async function waiting(rg: Rig) {
  await overrun(rg);
  await rg.run(600);
  expect(rg.c.state.name).toBe("PAUSED_FOR_QUESTION");
}

describe("stop", () => {
  it("while waiting for an answer: silences everything and goes back to the beginning; play starts from the top", async () => {
    await waiting(r);
    r.c.stop();
    await flush();
    expect(r.c.state.name).toBe("IDLE");
    expect(r.engine.time).toBe(0);
    expect(r.engine.playing).toBe(false);
    expect(r.engine.volume).toBe(1);
    expect(r.c.state.blockingId).toBeNull();
    r.c.play();
    await flush();
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.playing).toBe(true);
    expect(r.engine.time).toBe(0);
  });
  it("while playing", async () => {
    r.engine.time = 30;
    r.c.play();
    await flush();
    r.c.stop();
    await flush();
    expect([r.c.state.name, r.engine.time, r.engine.playing]).toEqual(["IDLE", 0, false]);
  });
  it("in the middle of a fade-out: cancels it and leaves the gain at full volume", async () => {
    await overrun(r);
    await r.run(150);
    expect(r.c.state.name).toBe("FADING_OUT");
    expect(r.engine.volume).toBeLessThan(1);
    r.c.stop();
    await r.run(600);
    expect(r.c.state.name).toBe("IDLE");
    expect(r.engine.volume).toBe(1);
    expect(r.engine.playing).toBe(false);
    expect(r.engine.time).toBe(0);
  });
  it("from an error state", async () => {
    r.engine.rejectNextPlay = true;
    r.c.play();
    await flush();
    expect(r.c.state.name).toBe("ERROR");
    r.c.stop();
    await flush();
    expect(r.c.state.name).toBe("IDLE");
  });
  it("a failed seek is an error", async () => {
    r.engine.failNextSeek = true;
    r.c.stop();
    await flush();
    expect(r.c.state.name).toBe("ERROR");
    expect(r.c.state.error).toContain("seek_failed");
  });
  it("a stop whose seek is still pending never resurrects anything after an error", async () => {
    r.engine.holdSeeks = true;
    r.c.stop();
    r.c.notifyError("device lost");
    r.engine.releaseSeek();
    await flush();
    expect(r.c.state.name).toBe("ERROR");
    expect(r.engine.playing).toBe(false);
  });
});

describe("play while a question is open", () => {
  it("resumes the audio from where it waits — and the 3-second rule pauses it again if still unanswered", async () => {
    await waiting(r);
    r.c.play();
    expect(r.c.state.name).toBe("PLAYING");
    await flush();
    expect(r.engine.playing).toBe(true);
    expect(r.engine.volume).toBe(1);
    expect(r.engine.time).toBe(45.3);
    await r.run(12000); // 45.3 → passes 52.1 + 3 = 55.1 → recovery again
    expect(["FADING_OUT", "SEEKING", "PAUSED_FOR_QUESTION"]).toContain(r.c.state.name);
    await r.run(800);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.engine.time).toBe(45.3); // back at the previous line, waiting again
    expect(r.engine.playing).toBe(false);
    expect(r.c.state.blockingId).toBe(19);
    expect([...r.answered]).toEqual([]);
  });
  it("answering while it plays simply carries on", async () => {
    await waiting(r);
    r.c.play();
    await flush();
    await r.run(1500);
    r.answer(19);
    await r.run(600);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.playing).toBe(true);
  });
  it("pause stops it again", async () => {
    await waiting(r);
    r.c.play();
    await flush();
    r.c.pause();
    expect(r.c.state.name).toBe("PAUSED");
    expect(r.engine.playing).toBe(false);
  });
});

describe("rewind", () => {
  it("while playing: jumps back and keeps playing; never before 0", async () => {
    r.engine.time = 30;
    r.c.play();
    await flush();
    r.c.rewind(5);
    await flush();
    expect(r.engine.time).toBe(25);
    expect(r.c.state.name).toBe("PLAYING");
    r.engine.time = 2;
    r.c.rewind(5);
    await flush();
    expect(r.engine.time).toBe(0);
  });
  it("while waiting for an answer: goes back 5 s and plays the part again, then waits again at the deadline", async () => {
    await waiting(r); // paused at 45.3
    r.c.rewind(5);
    await flush();
    expect(r.engine.time).toBeCloseTo(40.3, 5);
    expect(r.c.state.name).toBe("PLAYING");
    expect(r.engine.playing).toBe(true);
    expect(r.engine.volume).toBe(1);
    await r.run(18000); // 40.3 → 55.1 plus the fade-out, rewind and settling
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.engine.time).toBe(45.3);
    expect([...r.answered]).toEqual([]);
  });
  it("can be pressed repeatedly to go further back", async () => {
    await waiting(r);
    r.c.rewind(5);
    await flush();
    r.c.rewind(5);
    await flush();
    expect(r.engine.time).toBeCloseTo(35.3, 5);
  });
  it("from stopped states (idle / paused / error): goes back and plays", async () => {
    r.engine.time = 20;
    r.c.rewind(5);
    await flush();
    expect([r.c.state.name, r.engine.time, r.engine.playing]).toEqual(["PLAYING", 15, true]);
    r.c.pause();
    r.c.rewind(5);
    await flush();
    expect([r.c.state.name, r.engine.time]).toEqual(["PLAYING", 10]);
  });
  it("is ignored while the game rewinds itself", async () => {
    await overrun(r);
    expect(r.c.state.name).toBe("FADING_OUT");
    r.c.rewind(5);
    expect(r.engine.count("seek:")).toBe(0);
    await r.run(500);
    expect(r.c.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(r.engine.time).toBe(45.3);
  });
  it("an answer given while its seek is pending is not overridden", async () => {
    await waiting(r);
    const plays = r.engine.count("play");
    r.engine.holdSeeks = true;
    r.c.rewind(5);
    r.answer(19); // resumes right away (fade-in), superseding the pending rewind-then-play
    expect(r.c.state.name).toBe("FADING_IN");
    r.engine.releaseSeek();
    await flush();
    expect(r.engine.count("play") - plays).toBe(1); // only the answer's play, not a second one
  });
  it("a rewind whose seek is still pending never resurrects playback after an error", async () => {
    await waiting(r);
    r.engine.holdSeeks = true;
    r.c.rewind(5);
    r.c.notifyError("device lost"); // supersedes it
    expect(r.c.state.name).toBe("ERROR");
    r.engine.releaseSeek();
    await flush();
    expect(r.c.state.name).toBe("ERROR");
    expect(r.engine.playing).toBe(false);
  });
  it("a failed seek is an error", async () => {
    await waiting(r);
    r.engine.failNextSeek = true;
    r.c.rewind(5);
    await flush();
    expect(r.c.state.name).toBe("ERROR");
  });
  it("works in free play", async () => {
    const f = rig([], { gating: false });
    f.engine.time = 30;
    f.c.rewind(5);
    await flush();
    expect([f.c.state.name, f.engine.time]).toEqual(["PLAYING", 25]);
  });
});
