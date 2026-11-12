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
  it("is 48px high without the queue bar and starts 48px above the queue bar's top edge with it, solid from the bar's middle", () => {
    expect(css).toMatch(/\.nav-fade \{[^}]*height: 48px/);
    expect(css).toMatch(/\.shell:has\(\.queue-bar\) \.nav-fade \{[^}]*height: calc\(8px \+ var\(--queue-h, 60px\) \+ 48px\)[^}]*var\(--bg\) calc\(48px \+ var\(--queue-h, 60px\) \/ 2\)/);
  });
});
