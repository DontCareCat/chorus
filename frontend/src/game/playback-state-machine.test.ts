import { describe, expect, it } from "vitest";
import { initialState, transition } from "./playback-state-machine";
import type { MachineEvent, MachineState, PlaybackStateName } from "./playback-state-machine";

const at = (name: PlaybackStateName, patch: Partial<MachineState> = {}): MachineState => ({ ...initialState, name, ...patch });
const blocked = (name: PlaybackStateName, extra: Partial<MachineState> = {}) =>
  at(name, { blockingId: 19, target: 45.3, ...extra });
const overdue: MachineEvent = { type: "OVERDUE", questionId: 19, target: 45.3, ended: false };
const types = (s: MachineState, e: MachineEvent) => transition(s, e).effects.map((x) => x.type);

describe("legal transitions and their exact effects", () => {
  it("IDLE → PLAYING on PLAY", () => {
    const t = transition(at("IDLE"), { type: "PLAY" });
    expect(t.state.name).toBe("PLAYING");
    expect(t.effects).toEqual([{ type: "setVolume", volume: 1 }, { type: "play" }]);
  });
  it("PLAYING → FADING_OUT on OVERDUE, remembering the blocking question and target", () => {
    const t = transition(at("PLAYING"), overdue);
    expect(t.state).toMatchObject({ name: "FADING_OUT", blockingId: 19, target: 45.3 });
    expect(t.effects).toEqual([{ type: "fadeOut" }]);
  });
  it("FADING_OUT → SEEKING on FADE_DONE: pause, then seek to the target", () => {
    const t = transition(blocked("FADING_OUT"), { type: "FADE_DONE" });
    expect(t.state.name).toBe("SEEKING");
    expect(t.effects).toEqual([{ type: "pause" }, { type: "seek", time: 45.3 }]);
  });
  it("SEEKING → PAUSED_FOR_QUESTION on SEEK_DONE", () => {
    expect(transition(blocked("SEEKING"), { type: "SEEK_DONE" }).state.name).toBe("PAUSED_FOR_QUESTION");
  });
  it("PAUSED_FOR_QUESTION → FADING_IN when the blocking question is answered", () => {
    const t = transition(blocked("PAUSED_FOR_QUESTION"), { type: "ANSWERED", questionId: 19, next: null });
    expect(t.state).toMatchObject({ name: "FADING_IN", blockingId: null });
    expect(t.effects).toEqual([{ type: "play" }, { type: "fadeIn" }]);
  });
  it("FADING_IN → PLAYING on FADE_DONE", () => {
    expect(transition(at("FADING_IN"), { type: "FADE_DONE" }).state.name).toBe("PLAYING");
  });
  it("FADING_OUT → FADING_IN when answered mid-fade: cancel the fade first, no seek, no pause", () => {
    const t = transition(blocked("FADING_OUT"), { type: "ANSWERED", questionId: 19, next: null });
    expect(t.state.name).toBe("FADING_IN");
    expect(t.effects).toEqual([{ type: "cancelFade" }, { type: "fadeIn" }]);
  });
  it("FADING_IN → FADING_OUT on a new OVERDUE: cancel the fade-in first", () => {
    const t = transition(at("FADING_IN"), overdue);
    expect(t.state.name).toBe("FADING_OUT");
    expect(t.effects).toEqual([{ type: "cancelFade" }, { type: "fadeOut" }]);
  });
  it("overdue with the audio already ended skips the fade and seeks straight away", () => {
    const t = transition(at("PLAYING"), { ...overdue, ended: true } as MachineEvent);
    expect(t.state.name).toBe("SEEKING");
    expect(t.effects).toEqual([{ type: "setVolume", volume: 0 }, { type: "pause" }, { type: "seek", time: 45.3 }]);
  });
  it("answer during SEEKING resumes after the seek; a changed blocker triggers a re-seek", () => {
    const resume = transition(blocked("SEEKING"), { type: "ANSWERED", questionId: 19, next: null }).state;
    expect(resume.resumeAfterSeek).toBe(true);
    const t = transition(resume, { type: "SEEK_DONE" });
    expect(t.state.name).toBe("FADING_IN");
    expect(t.effects).toEqual([{ type: "play" }, { type: "fadeIn" }]);

    const moved = transition(blocked("SEEKING"), { type: "ANSWERED", questionId: 19, next: { questionId: 20, target: 49 } }).state;
    expect(moved).toMatchObject({ blockingId: 20, target: 49, reseek: true });
    const t2 = transition(moved, { type: "SEEK_DONE" });
    expect(t2.state.name).toBe("SEEKING");
    expect(t2.effects).toEqual([{ type: "seek", time: 49 }]);
  });
  it("user pause and resume", () => {
    expect(transition(at("PLAYING"), { type: "USER_PAUSE" }).state.name).toBe("PAUSED");
    expect(transition(at("PAUSED"), { type: "PLAY" }).state.name).toBe("PLAYING");
  });
});

describe("idempotency: events that must change nothing", () => {
  const recovering: PlaybackStateName[] = ["FADING_OUT", "SEEKING", "PAUSED_FOR_QUESTION"];
  it.each(recovering)("OVERDUE while %s is ignored (no second fade or seek)", (name) => {
    const s = blocked(name);
    const t = transition(s, overdue);
    expect(t.state).toBe(s);
    expect(t.effects).toEqual([]);
  });
  it.each(recovering)("answers to a non-blocking question while %s are ignored", (name) => {
    const s = blocked(name);
    const t = transition(s, { type: "ANSWERED", questionId: 20, next: null });
    expect(t.state).toBe(s);
    expect(t.effects).toEqual([]);
  });
  it("USER_PAUSE changes nothing while waiting for an answer", () => {
    const s = blocked("PAUSED_FOR_QUESTION");
    expect(transition(s, { type: "USER_PAUSE" })).toEqual({ state: s, effects: [] });
  });
  it("FADE_DONE / SEEK_DONE in unrelated states do nothing", () => {
    for (const name of ["IDLE", "PLAYING", "PAUSED", "PAUSED_FOR_QUESTION"] as const) {
      expect(types(at(name), { type: "FADE_DONE" })).toEqual([]);
      expect(types(at(name), { type: "SEEK_DONE" })).toEqual([]);
    }
  });
});

describe("play while waiting for an answer", () => {
  it("PAUSED_FOR_QUESTION → PLAYING at full volume; the question stays open (the 3-second rule watches it)", () => {
    const t = transition(blocked("PAUSED_FOR_QUESTION"), { type: "PLAY" });
    expect(t.state).toMatchObject({ name: "PLAYING", blockingId: null, target: null });
    expect(t.effects).toEqual([{ type: "setVolume", volume: 1 }, { type: "play" }]);
  });
  it("and an overrun then recovers exactly as from normal playback", () => {
    const playing = transition(blocked("PAUSED_FOR_QUESTION"), { type: "PLAY" }).state;
    expect(transition(playing, overdue).state).toMatchObject({ name: "FADING_OUT", blockingId: 19 });
  });
});

describe("errors", () => {
  it.each(["IDLE", "PLAYING", "FADING_OUT", "SEEKING", "PAUSED_FOR_QUESTION", "FADING_IN"] as const)("ERROR from %s", (name) => {
    const t = transition(at(name), { type: "ERROR", message: "boom" });
    expect(t.state).toMatchObject({ name: "ERROR", error: "boom" });
    expect(t.effects).toEqual([{ type: "cancelFade" }, { type: "pause" }]);
  });
  it("SEEK_FAILED → ERROR; PLAY from ERROR retries; RESET → IDLE", () => {
    expect(transition(blocked("SEEKING"), { type: "SEEK_FAILED", message: "x" }).state.name).toBe("ERROR");
    expect(transition(at("ERROR", { error: "x" }), { type: "PLAY" }).state).toMatchObject({ name: "PLAYING", error: null });
    expect(transition(at("ERROR"), { type: "RESET" }).state.name).toBe("IDLE");
  });
});

