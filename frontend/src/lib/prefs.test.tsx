// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { isBool, isId, isOneOf, isString, readPref, writePref } from "./prefs";

const clear = () => document.cookie.split("; ").forEach((c) => { document.cookie = `${c.split("=")[0]}=; max-age=0; path=/`; });

describe("prefs", () => {
  beforeEach(clear);

  it("gives the fallback when nothing was saved", () => {
    expect(readPref("filter", "all", isString)).toBe("all");
  });

  it("remembers values of every kind in a chorus_ cookie", () => {
    writePref("filter", "ready");
    writePref("regex", true);
    writePref("song", 12);
    writePref("query", "über (Straße)");
    expect(document.cookie).toContain("chorus_filter=");
    expect(readPref("filter", "all", isString)).toBe("ready");
    expect(readPref("regex", false, isBool)).toBe(true);
    expect(readPref("song", null, isId)).toBe(12);
    expect(readPref("query", "", isString)).toBe("über (Straße)");
  });

  it("ignores a value that is not allowed any more", () => {
    writePref("tab", "gone");
    expect(readPref("tab", "all", isOneOf("all", "song"))).toBe("all");
    writePref("size", 25);
    expect(readPref("size", 20, isOneOf(20, 40, 60))).toBe(20);
  });

  it("copes with a damaged cookie", () => {
    document.cookie = "chorus_filter=%7Bnot-json; path=/";
    expect(readPref("filter", "all", isString)).toBe("all");
  });

  it("a name that is a prefix of another does not read the other", () => {
    writePref("filter_long", "x");
    expect(readPref("filter", "all", isString)).toBe("all");
  });
});
