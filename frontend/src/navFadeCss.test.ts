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
  it("has the v2 curve: clear at its top, 45% at 10px, 75% at 22px, 92% at 36px and the page colour from 48px (the bar's top edge) down", () => {
    const rule = /\.nav-fade \{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/linear-gradient\(to bottom, transparent 0, /);
    const stops = [...rule.matchAll(/(?:color-mix\(in oklch, var\(--bg\) (\d+)%, transparent\)|var\(--bg\)) (\d+)px/g)].map((m) => ({ alpha: m[1] === undefined ? 100 : Number(m[1]), at: Number(m[2]) }));
    expect(stops).toEqual([{ alpha: 45, at: 10 }, { alpha: 75, at: 22 }, { alpha: 92, at: 36 }, { alpha: 100, at: 48 }]);
    expect(rule).toMatch(/var\(--bg\) 48px, var\(--bg\) 100%\)/);
    expect(rule).not.toMatch(/--fade-solid/);
  });
  it("tabs that are not selected use --text-2 over the fade", () => {
    expect(css).toMatch(/\.main-nav a \{ color: var\(--text-2\)/);
  });
  it("tablets: the tabs form one centred group of 96px items and the queue bar keeps 24px sides", () => {
    expect(css).toMatch(/@media \(min-width: 481px\) \{[^}]*\.main-nav\[data-variant="tabs"\] \{ grid-template-columns: repeat\(5, 96px\); justify-content: center; \}/);
    expect(css).toMatch(/\[data-layout="phone"\] \.queue-bar \{ left: 24px; right: 24px; \}/);
  });
  it("the header starts 12px under the status bar inset (and the game's top bar too)", () => {
    expect(css).toMatch(/\[data-layout="phone"\] \.topbar \{ padding: calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)/);
    expect(css).toMatch(/\.shell\[data-route="game"\] \.topbar \{[^}]*padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)/);
    expect(css).toMatch(/\[data-layout="phone"\] \.game-bar \{ padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)/);
  });
  it("nothing else paints a box behind the tab bar: the bar itself is transparent and has no border or shadow", () => {
    const bar = /\.main-nav\[data-variant="tabs"\] \{[^}]*\}/.exec(css)![0];
    expect(bar).toMatch(/background: transparent/);
    expect(bar).not.toMatch(/border|box-shadow|backdrop-filter/);
  });
});
