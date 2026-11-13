import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("wide touch screens (a tablet gets the phone layout at desktop widths)", () => {
  it("the queue bar is centred, not stuck to the left edge, when max-width stops it short of the screen", () => {
    expect(css).toMatch(/\.shell\[data-nav="tabs"\] \.queue-bar \{[^}]*margin: 0 auto/);
    expect(css).toMatch(/\[data-layout="phone"\] \.queue-bar \{[^}]*margin: 0 auto/);
  });
  it("the two-column game's player bar background runs to both screen edges", () => {
    expect(css).toMatch(/\.game\[data-game="two"\]\[data-yt\] \.transport \{[^}]*box-shadow: 0 0 0 100vmax var\(--surface-2\)[^}]*clip-path: inset\(0 -100vmax\)/);
    expect(css).toMatch(/\.game\[data-game="two"\]\[data-yt\] \.transport::before \{[^}]*left: -100vmax; right: -100vmax/);
  });
});
