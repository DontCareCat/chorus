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
