// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { WordEditor } from "./WordEditor";
import type { DictEntryDto } from "../services/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const addWord = vi.fn();
const editWord = vi.fn();
vi.mock("../services/api", async (orig) => ({ ...(await orig<typeof import("../services/api")>()), api: { addWord: (...a: unknown[]) => addWord(...a), editWord: (...a: unknown[]) => editWord(...a) } }));

let host: HTMLElement;
let root: Root;
const onSaved = vi.fn();
const onClose = vi.fn();
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  addWord.mockReset().mockResolvedValue({});
  editWord.mockReset().mockResolvedValue({});
  onSaved.mockReset();
  onClose.mockReset();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const inputs = () => [...document.querySelectorAll<HTMLInputElement>("input.pill")];
const submit = () => [...document.querySelectorAll<HTMLButtonElement>("button[type=submit]")][0]!;

describe("+ Add word", () => {
  beforeEach(async () => { await act(async () => root.render(<WordEditor defaultLanguage="de" onClose={onClose} onSaved={onSaved} />)); });

  it("cannot be sent without a word", () => {
    expect(submit().disabled).toBe(true);
  });

  it("adds the word by hand in the chosen language, with only the fields that were filled", async () => {
    await type(inputs()[0]!, "  Haus ");
    await act(async () => submit().click());
    expect(addWord).toHaveBeenCalledWith({ language: "de", word: "Haus", source: "manual" });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the meaning and the example when they were typed", async () => {
    await type(inputs()[0]!, "Haus");
    await type(inputs()[1]!, "house");
    await type(inputs()[2]!, "Das Haus ist alt");
    await act(async () => submit().click());
    expect(addWord).toHaveBeenCalledWith({ language: "de", word: "Haus", source: "manual", translation: "house", example: "Das Haus ist alt" });
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    addWord.mockRejectedValue(Object.assign(new Error("Type a word"), { name: "ApiError" }));
    await type(inputs()[0]!, "Haus");
    await act(async () => submit().click());
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("[role=alert]")).not.toBeNull();
  });
});

describe("Edit word", () => {
  const entry = { id: 9, language: "de", surface: "Haus", lemma: null, article: "das", translation: "house", pos: "noun" } as DictEntryDto;
  beforeEach(async () => { await act(async () => root.render(<WordEditor entry={entry} defaultLanguage="de" onClose={onClose} onSaved={onSaved} />)); });

  it("starts from what the word has and saves the four fields", async () => {
    expect(inputs().map((i) => i.value)).toEqual(["house", "", "das"]);
    await type(inputs()[0]!, "building");
    await type(inputs()[1]!, "Haus");
    await act(async () => submit().click());
    expect(editWord).toHaveBeenCalledWith(9, { translation: "building", lemma: "Haus", article: "das", pos: "noun" });
    expect(onSaved).toHaveBeenCalled();
  });
});
