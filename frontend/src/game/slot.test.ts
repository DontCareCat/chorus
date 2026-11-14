import { describe, expect, it } from "vitest";
import { slotTexts } from "./slot";

describe("slotTexts", () => {
  it("lists every option, so the slot is as wide as the widest", () => {
    expect(slotTexts([{ text: "Haus" }, { text: "Baum" }, { text: "Straßenbahn" }, { text: "Ei" }])).toEqual(["Haus", "Baum", "Straßenbahn", "Ei"]);
  });
  it("adds the shown word when it is not among the options, once when it is", () => {
    expect(slotTexts([{ text: "Haus" }], "Hauses")).toEqual(["Haus", "Hauses"]);
    expect(slotTexts([{ text: "Haus" }, { text: "Baum" }], "Haus")).toEqual(["Haus", "Baum"]);
  });
  it("skips empty texts and gives an empty list without options (the CSS minimum width applies)", () => {
    expect(slotTexts([{ text: " " }, { text: "" }])).toEqual([]);
    expect(slotTexts([], undefined)).toEqual([]);
  });
});
