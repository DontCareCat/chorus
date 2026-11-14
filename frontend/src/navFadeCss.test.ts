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
  it("is one smooth gradient: clear at the top, a little more at every stop, the page colour at the very bottom, no solid band or box", () => {
    const rule = /\.nav-fade \{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/linear-gradient\(to bottom, transparent 0%/);
    const stops = [...rule.matchAll(/(?:color-mix\(in oklch, var\(--bg\) (\d+)%, transparent\)|var\(--bg\)) (\d+)%/g)].map((m) => ({ alpha: m[1] === undefined ? 100 : Number(m[1]), at: Number(m[2]) }));
    expect(stops.length).toBeGreaterThanOrEqual(6);
    expect(stops[stops.length - 1]).toEqual({ alpha: 100, at: 100 });
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.alpha).toBeGreaterThan(stops[i - 1]!.alpha); // it intensifies at every stop
      expect(stops[i]!.at).toBeGreaterThan(stops[i - 1]!.at);
    }
    expect(stops[0]!.alpha).toBeLessThanOrEqual(5); // the top of the scrim leaves the content as it is
    expect(stops.filter((s) => s.alpha >= 99).length).toBe(1); // opaque only at the screen edge
    expect(rule).not.toMatch(/--fade-solid/);
  });
  it("nothing else paints a box behind the tab bar: the bar itself is transparent and has no border or shadow", () => {
    const bar = /\.main-nav\[data-variant="tabs"\] \{[^}]*\}/.exec(css)![0];
    expect(bar).toMatch(/background: transparent/);
    expect(bar).not.toMatch(/border|box-shadow|backdrop-filter/);
  });
});
