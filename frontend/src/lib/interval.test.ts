import { describe, expect, it } from "vitest";
import { formatInterval, formatWait } from "./interval";

describe("formatInterval", () => {
  it.each([
    [30, "< 1 min"], [60, "1 min"], [600, "10 min"], [3600, "1 h"], [5 * 3600, "5 h"], [86400, "1 d"], [216000, "2.5 d"],
    [345600, "4 d"], [10 * 86400, "10 d"], [90 * 86400, "3 mo"], [365 * 86400, "1 y"],
  ])("%i s is %s", (s, label) => expect(formatInterval(s)).toBe(label));
  it("says when the next card is due", () => {
    expect(formatWait(0)).toBe("now");
    expect(formatWait(12 * 60 * 1000)).toBe("in 12 min");
    expect(formatWait(5000)).toBe("in 1 min");
  });
});
