// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { layoutFor, typing } from "./useLayout";

const device = (width: number, height: number, touch = false) => (q: string) => {
  const portrait = height > width;
  const parts = q.split(/,(?![^(]*\))/).map((p) => p.trim());
  const test = (p: string): boolean =>
    p.split(" and ").every((c) => {
      if (c === "(orientation: portrait)") return portrait;
      if (c === "(pointer: coarse)" || c === "(hover: none)") return touch;
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
  it("any touch screen gets the phone layout, whatever its size", () => {
    expect(layoutFor(device(1180, 820, true))).toBe("phone"); // an iPad on its side
    expect(layoutFor(device(1366, 1024, true))).toBe("phone"); // the biggest iPad
    expect(layoutFor(device(1440, 900, false))).toBe("desktop"); // the same size with a mouse
  });
  it("desktops are desktops", () => {
    expect(layoutFor(device(1440, 900))).toBe("desktop");
    expect(layoutFor(device(1920, 1080))).toBe("desktop");
  });
});

describe("typing", () => {
  it("is true for text fields and false for buttons", () => {
    const input = document.createElement("input");
    const box = document.createElement("input"); box.type = "checkbox";
    const btn = document.createElement("button");
    expect([typing(input), typing(box), typing(btn), typing(null)]).toEqual([true, false, false, false]);
  });
});
