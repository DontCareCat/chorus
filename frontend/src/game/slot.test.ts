import { describe, expect, it } from "vitest";
import { TYPING_SLOT, slotTexts } from "./slot";

describe("slotTexts", () => {
  it("lists every option, so the slot is as wide as the widest", () => {
    expect(slotTexts([{ text: "Haus" }, { text: "Baum" }, { text: "Straßenbahn" }, { text: "Ei" }])).toEqual(["Haus", "Baum", "Straßenbahn", "Ei"]);
  });
  it("adds the shown word when it is not among the options, once when it is", () => {
    expect(slotTexts([{ text: "Haus" }], "Hauses")).toEqual(["Haus", "Hauses"]);
    expect(slotTexts([{ text: "Haus" }, { text: "Baum" }], "Haus")).toEqual(["Haus", "Baum"]);
  });
  it("skips empty options", () => {
    expect(slotTexts([{ text: " " }, { text: "Haus" }, { text: "" }])).toEqual(["Haus"]);
  });
  it("without options (typing mode) reserves a fixed room, and the answered word on top of it", () => {
    expect(slotTexts([])).toEqual([TYPING_SLOT]);
    expect(slotTexts([], "Haus")).toEqual([TYPING_SLOT, "Haus"]);
  });
});
