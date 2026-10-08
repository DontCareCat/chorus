import { describe, expect, it } from "vitest";
import { describeStatus } from "./status";

const err = (error: string) => describeStatus({ state: "ERROR", error, runway: null, freePlay: false });

describe("playback errors are explained by their cause", () => {
  it("autoplay policy → press play again", () => {
    expect(err("play_rejected: NotAllowedError: play() failed").text).toMatch(/blocked by the browser/);
  });
  it("a missing or unsupported file is not blamed on the browser's autoplay policy", () => {
    expect(err("play_rejected: NotSupportedError: no supported source").text).toMatch(/missing or in a format/);
    expect(err("audio error").text).toMatch(/missing or in a format/);
    expect(err("MEDIA_ERR_SRC_NOT_SUPPORTED").text).toMatch(/missing or in a format/);
  });
  it("anything else is a generic playback problem, still with a way forward", () => {
    expect(err("seek_failed: timed out").text).toMatch(/Playback problem. Press play to try again/);
  });
});
