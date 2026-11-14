import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("the lyrics lookup bar", () => {
  it("keeps a gutter between its results and its right edge (4px bar padding + 10px on the results = 14px)", () => {
    expect(css).toMatch(/\.lookup-bar \{[^}]*padding: 0 4px 4px 12px/);
    expect(css).toMatch(/\.lookup-groups \{[^}]*padding-right: 10px/);
  });
});
