// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NavFade } from "./NavFade";

const heights: Record<string, number> = { "main-nav": 68, "queue-bar": 66 };
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return heights[(this as HTMLElement).className.split(" ")[0]!] ?? 0; } });
});
afterEach(cleanup);

describe("NavFade", () => {
  it("is a 48px gradient directly above the tab bar when there is no queue bar", () => {
    const { container } = render(<div className="shell"><nav className="main-nav" /><NavFade /></div>);
    const fade = container.querySelector<HTMLElement>(".nav-fade")!;
    expect(fade.style.getPropertyValue("--fade-h")).toBe(`${68 + 48}px`); // the tab bar plus 48px, solid from the tab bar's top edge
    expect(fade.style.getPropertyValue("--fade-solid")).toBe("48px");
  });
  it("starts 48px above the queue bar and is solid from its middle", () => {
    const { container } = render(<div className="shell"><nav className="main-nav" /><div className="queue-bar" style={{ bottom: "72px" }} /><NavFade /></div>);
    const fade = container.querySelector<HTMLElement>(".nav-fade")!;
    expect(fade.style.getPropertyValue("--fade-h")).toBe(`${72 + 66 + 48}px`); // up to 48px over the bar's top edge
    expect(fade.style.getPropertyValue("--fade-solid")).toBe(`${48 + 33}px`);
  });
});
