import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("the song's play options panel on a phone", () => {
  it("stacks its groups without wrapping, so they do not fly in from the side while the panel opens", () => {
    // the panel's height grows from 0 when it opens; a wrapping column flex box would push the groups into extra columns until it is tall enough
    const rule = css.split("\n").find((l) => l.startsWith('[data-layout="phone"] .start-panel {') && l.includes("flex-direction: column"));
    expect(rule).toBeDefined();
    expect(rule).toMatch(/flex-wrap:\s*nowrap/);
  });
});

describe("beta.25 regressions (CSS guards)", () => {
  const rule = (start: string) => css.split("\n").find((l) => l.startsWith(start));
  it("the lyric lines animate their size (the focus animation)", () => {
    expect(rule(".lw-line {")).toMatch(/transition:[^;]*font-size/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.lw-line, \.lw-line time \{ transition: none/);
  });
  it("the dictionary badge hangs on the icon's corner, not on the far edge of the tab", () => {
    expect(rule(".main-nav .nav-badge {")).toMatch(/left:\s*calc\(50% \+ 2px\)/);
    expect(rule(".main-nav .nav-badge {")).not.toMatch(/right:\s*0/);
  });
  it("answer numbers carry no bottom-padding hack", () => {
    expect(rule(".opt-key {")).not.toMatch(/padding-bottom/);
  });
  it("the old hamburger menu styles are gone", () => {
    expect(css).not.toMatch(/\.menu-btn|\.menu-panel|\.burger/);
  });
});
