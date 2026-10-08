import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it("parses every page", () => {
    expect(parseRoute("")).toEqual({ name: "library" });
    expect(parseRoute("#/")).toEqual({ name: "library" });
    expect(parseRoute("#/settings")).toEqual({ name: "settings" });
    expect(parseRoute("#/songs/12")).toEqual({ name: "song", songId: 12 });
    expect(parseRoute("#/games/3f2b8c1e-aaaa-bbbb-cccc-123456789abc")).toEqual({ name: "game", publicId: "3f2b8c1e-aaaa-bbbb-cccc-123456789abc" });
  });
  it("rejects anything else", () => {
    expect(parseRoute("#/songs/abc").name).toBe("notfound");
    expect(parseRoute("#/games/../../etc").name).toBe("notfound");
    expect(parseRoute("#/nope").name).toBe("notfound");
  });
});
