import { describe, expect, it } from "vitest";
import { applyViewport, layoutFor } from "./useLayout";

const device = (width: number, height: number) => (q: string) => {
  const portrait = height > width;
  const parts = q.split(/,(?![^(]*\))/).map((p) => p.trim());
  const test = (p: string): boolean =>
    p.split(" and ").every((c) => {
      if (c === "(orientation: portrait)") return portrait;
      const m = /\((max-width|max-height): (\d+)px\)/.exec(c);
      if (!m) return false;
      return (m[1] === "max-width" ? width : height) <= Number(m[2]);
    });
  return parts.some(test);
};

describe("layout modes", () => {
  it("phones and tablets held upright get the phone layout", () => {
    expect(layoutFor(device(390, 844))).toBe("phone");
    expect(layoutFor(device(412, 915))).toBe("phone");
    expect(layoutFor(device(800, 1280))).toBe("phone");
    expect(layoutFor(device(844, 390))).toBe("phone"); // a phone on its side: too short for two columns
  });
  it("tablets on their side and small laptops are compact", () => {
    expect(layoutFor(device(1280, 690))).toBe("compact");
    expect(layoutFor(device(1180, 820))).toBe("compact");
  });
  it("desktops are desktops", () => {
    expect(layoutFor(device(1440, 900))).toBe("desktop");
    expect(layoutFor(device(1920, 1080))).toBe("desktop");
  });
});

describe("visual viewport", () => {
  it("publishes what the person can see, so the player stays above the browser bars", () => {
    const vars = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => vars.set(k, v), getPropertyValue: (k: string) => vars.get(k) ?? "" } } as unknown as HTMLElement;
    applyViewport({ height: 727.4, offsetTop: 0 }, root);
    expect(root.style.getPropertyValue("--app-h")).toBe("727px");
    applyViewport({ height: 640, offsetTop: 56.2 }, root);
    expect(root.style.getPropertyValue("--app-h")).toBe("640px");
    expect(root.style.getPropertyValue("--app-top")).toBe("56px");
  });
});
