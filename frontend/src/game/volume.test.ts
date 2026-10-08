import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOLUME, clampVolume, effectiveVolume, parseStoredVolume, serializeVolume, stepVolume, volumeIcon,
} from "./volume";

describe("clampVolume / stepVolume", () => {
  it("keeps the volume within 0..1 and repairs garbage", () => {
    expect([clampVolume(-1), clampVolume(0.4), clampVolume(7)]).toEqual([0, 0.4, 1]);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VOLUME);
  });
  it("steps by 5 % on a clean grid, with no floating-point drift", () => {
    let v = 0;
    for (let i = 0; i < 7; i++) v = stepVolume(v, 1);
    expect(v).toBe(0.35);
    // twenty steps up and back down land exactly on the grid (unrounded 0.05 steps drift to 0.15000000000000002 ...)
    let up = 0;
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) seen.push((up = stepVolume(up, 1)));
    expect(seen.every((x) => Number.isInteger(Math.round(x * 100)) && Math.abs(x * 100 - Math.round(x * 100)) < 1e-9 && String(x).length <= 4)).toBe(true);
    expect(up).toBe(1);
    expect(stepVolume(0.3, 1)).toBe(0.35);
    expect(stepVolume(0.35, -1)).toBe(0.3);
  });
  it("stops at both ends", () => {
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(0.97, 1)).toBe(1);
  });
});

describe("volumeIcon", () => {
  it("is crossed out when muted or at zero, and grows with the level", () => {
    expect(volumeIcon(0.8, true)).toBe("volumeOff");
    expect(volumeIcon(0, false)).toBe("volumeOff");
    expect(volumeIcon(0.1, false)).toBe("volumeMute");
    expect(volumeIcon(0.5, false)).toBe("volumeDown");
    expect(volumeIcon(0.9, false)).toBe("volumeUp");
    expect(volumeIcon(1, false)).toBe("volumeUp");
  });
});

describe("effectiveVolume", () => {
  it("is silent while muted but remembers the level", () => {
    expect(effectiveVolume({ volume: 0.6, muted: true })).toBe(0);
    expect(effectiveVolume({ volume: 0.6, muted: false })).toBe(0.6);
  });
});

describe("stored volume", () => {
  it("round-trips", () => {
    expect(parseStoredVolume(serializeVolume({ volume: 0.35, muted: true }))).toEqual({ volume: 0.35, muted: true });
  });
  it("falls back to full volume for anything missing or malformed", () => {
    const full = { volume: 1, muted: false };
    expect(parseStoredVolume(null)).toEqual(full);
    expect(parseStoredVolume("not json")).toEqual(full);
    expect(parseStoredVolume("{}")).toEqual(full);
    expect(parseStoredVolume('{"volume":"loud","muted":"yes"}')).toEqual(full);
  });
  it("clamps a tampered value", () => {
    expect(parseStoredVolume('{"volume":9}').volume).toBe(1);
    expect(parseStoredVolume('{"volume":-4}').volume).toBe(0);
  });
});
