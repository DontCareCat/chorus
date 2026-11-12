// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { DictionaryExchange } from "./DictionaryExchange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../services/api", async (orig) => ({ ...(await orig<typeof import("../services/api")>()), api: { importDeck: vi.fn(async () => ({ added: 1, existing: 0, skipped: 0 })) } }));

let host: HTMLElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

const pick = async (name: string) => {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], name)] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
};
const importButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Import")!;

describe("the Anki import dialog", () => {
  beforeEach(async () => { await act(async () => root.render(<DictionaryExchange mode="import" scope={{ status: "all" }} shown={0} defaultLanguage="de" onClose={() => undefined} onImported={() => undefined} />)); });
  it("turns away a file that is not a deck or a text list, and says why", async () => {
    await pick("setup.exe");
    expect(document.body.textContent).toContain("That file type is not supported");
    expect(document.body.textContent).toContain("No file chosen");
    expect(importButton().disabled).toBe(true);
  });
  it("takes a deck and the text list formats", async () => {
    for (const name of ["words.apkg", "WORDS.APKG", "list.txt", "list.csv", "list.tsv"]) {
      await pick(name);
      expect(document.body.textContent).not.toContain("not supported");
      expect(document.body.textContent).toContain(name);
      expect(importButton().disabled).toBe(false);
    }
  });
});
