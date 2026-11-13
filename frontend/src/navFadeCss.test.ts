import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const z = (selector: string) => {
  const rules = css.split("\n").filter((l) => l.startsWith(`${selector} {`) || l.startsWith(`${selector}{`));
  const all = rules.flatMap((r) => [...r.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => Number(m[1])));
  return all.at(-1);
};

describe("the fade above the tab bar", () => {
  it("is a separate element: the tab bar has no ::after that would paint over the queue bar", () => {
    expect(css).not.toMatch(/\.main-nav\[data-variant="tabs"\]::after/);
  });
  it("stacks page < fade < queue bar < tab bar", () => {
    const fade = z(".nav-fade")!, queue = z('[data-layout="phone"] .queue-bar')!, tabs = z('.main-nav[data-variant="tabs"]')!;
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(queue);
    expect(queue).toBeLessThan(tabs);
  });
  it("never takes a tap", () => {
    expect(css).toMatch(/\.nav-fade \{[^}]*pointer-events: none/);
  });
  it("starts at the bottom of the screen and is the tab bar's background", () => {
    expect(css).toMatch(/\.nav-fade \{[^}]*bottom: 0/);
    expect(css).toMatch(/\.main-nav\[data-variant="tabs"\] \{[^}]*background: transparent/);
  });
  it("is solid from --fade-solid down (48px above the tab bar's top, or the queue bar's middle)", () => {
    expect(css).toMatch(/\.nav-fade \{[^}]*height: var\(--fade-h[^}]*var\(--bg\) var\(--fade-solid, 48px\)/);
  });
});
