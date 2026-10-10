import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noAutofill } from "./noAutofill";

const root = new URL("..", import.meta.url).pathname;
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

describe("noAutofill", () => {
  it("switches off autofill, correction, capitalisation and spell-check, and tells password managers to keep out", () => {
    expect(noAutofill("x")).toMatchObject({
      name: "chorus-x", autoComplete: "off", autoCorrect: "off", autoCapitalize: "none", spellCheck: false,
      "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true", "data-form-type": "other",
    });
  });
  it("the name never looks like personal data", () => {
    for (const n of ["word-answer", "library-search", "import-path", "song-artist", "song-album", "song-title"]) {
      expect(noAutofill(n).name).toMatch(/^chorus-/);
    }
  });
});

describe("every free-text field in the app", () => {
  const files = sources(root).filter((p) => !p.endsWith("LoginPage.tsx")); // sign-in fields NEED autofill
  const inputs = files.flatMap((p) => {
    const text = readFileSync(p, "utf8");
    // each <input ... /> element up to its closing "/>" (attributes may span lines and contain "=>")
    return [...text.matchAll(/<input\b([\s\S]*?)\/>/g)].map((m) => ({ file: p.replace(root, ""), tag: m[0] }));
  });
  const freeText = inputs.filter(({ tag }) => !/type="(checkbox|radio|file|range|number|password)"/.test(tag));

  it("finds the text fields (so this check cannot pass by finding nothing)", () => {
    expect(freeText.length).toBeGreaterThanOrEqual(10);
  });
  it("has autofill switched off", () => {
    const bad = freeText.filter(({ tag }) => !tag.includes("noAutofill("));
    expect(bad.map((b) => b.file + ": " + b.tag.slice(0, 80))).toEqual([]);
  });
  it("sits in a form that has autoComplete off, or in none", () => {
    const bad = files.flatMap((p) => [...readFileSync(p, "utf8").matchAll(/<form\b([^>]*)>/g)].filter((m) => !m[1]!.includes('autoComplete="off"')).map((m) => p.replace(root, "") + ": " + m[0].slice(0, 60)));
    expect(bad).toEqual([]);
  });
});
