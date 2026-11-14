import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("the lyrics lookup bar", () => {
  it("balances the insets: the results are 12px from the right edge (4px bar padding + 8px), like the content on the left (12px)", () => {
    expect(css).toMatch(/\.lookup-bar \{[^}]*padding: 0 4px 4px 12px/);
    expect(css).toMatch(/\.lookup-groups \{[^}]*padding-right: 8px/);
  });
  it("the retry button's icon is 12px from the edge too (1px bar padding + 11px inside its 44px circle)", () => {
    expect(css).toMatch(/\.lookup-bar:not\(\[data-tier="L"\]\):has\(\.lookup-retry\) \{ padding-right: 1px; \}/);
  });
});
