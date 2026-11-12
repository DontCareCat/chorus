// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { WordCard } from "./WordCard";
import type { WordLookupDto } from "../services/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const info: WordLookupDto = {
  word: "papel", headword: "el papel", lemma: null, article: "el", pos: "noun", translation: "paper", translation_language: "en",
  sentence: "sobre el río de papel", sentence_translation: "over the paper river", entry_id: null, offline: false,
};
const lookupWord = vi.fn();
const addWord = vi.fn();
vi.mock("../services/api", async (orig) => ({ ...(await orig<typeof import("../services/api")>()), api: { lookupWord: (...a: unknown[]) => lookupWord(...a), addWord: (...a: unknown[]) => addWord(...a) } }));

const hit = { word: "papel", line: "sobre el río de papel", rect: new DOMRect(150, 300, 50, 24) };
let host: HTMLElement;
let root: Root;
const close = vi.fn();
const show = async () => { await act(async () => root.render(<WordCard hit={hit} language="es" songId={7} onClose={close} />)); };
const addButton = () => document.querySelector<HTMLButtonElement>(".wc-add")!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  lookupWord.mockReset().mockResolvedValue(info);
  addWord.mockReset().mockResolvedValue({ id: 1 });
  close.mockReset();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

describe("the word card", () => {
  it("looks the tapped word up with its song and line and shows headword, type, meaning and the translated line", async () => {
    await show();
    expect(lookupWord).toHaveBeenCalledWith("es", "papel", 7, "sobre el río de papel");
    const text = document.querySelector(".word-card")!.textContent!;
    for (const part of ["el papel", "noun", "paper", "sobre el río de papel", "over the paper river", "Paused. Tap outside to keep playing."]) expect(text).toContain(part);
    expect(addButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("adds the word as a tap and turns the + into a check, once", async () => {
    await show();
    await act(async () => addButton().click());
    expect(addWord).toHaveBeenCalledWith({ language: "es", word: "papel", song_id: 7, line: "sobre el río de papel", source: "tap" });
    expect(addButton().getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".word-card")!.textContent).toContain("Added to your dictionary");
    await act(async () => addButton().click());
    expect(addWord).toHaveBeenCalledTimes(1);
  });

  it("shows the check at once for a word that is in the dictionary already", async () => {
    lookupWord.mockResolvedValue({ ...info, entry_id: 5 });
    await show();
    expect(addButton().getAttribute("aria-pressed")).toBe("true");
    expect(addWord).not.toHaveBeenCalled();
  });

  it("says there is no connection when the services cannot be reached, and Add is still there", async () => {
    lookupWord.mockResolvedValue({ ...info, translation: null, pos: null, sentence_translation: null, headword: "papel", offline: true });
    await show();
    expect(document.querySelector(".word-card")!.textContent).toContain("No connection");
    await act(async () => addButton().click());
    expect(addWord).toHaveBeenCalled();
  });

  it("shows the word alone with the same message when the lookup request itself fails", async () => {
    lookupWord.mockRejectedValue(new Error("down"));
    await show();
    expect(document.querySelector(".word-card")!.textContent).toContain("papel");
    expect(document.querySelector(".word-card")!.textContent).toContain("No connection");
  });

  it("closes on a tap outside (which does nothing else) and on Esc, not on a tap inside", async () => {
    await show();
    await act(async () => { document.querySelector(".wc-meaning")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(close).not.toHaveBeenCalled();
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
