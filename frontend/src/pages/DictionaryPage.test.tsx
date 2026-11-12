// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { ConfirmProvider } from "../components/Confirm";
import type { DictEntryDto } from "../services/api";
import { DictionaryPage } from "./DictionaryPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const word = (id: number): DictEntryDto => ({
  id, language: "de", surface: `wort${id}`, lemma: null, article: null, translation: `word ${id}`, translation_language: "en", pos: null, zipf: null,
  source: "game", meaning_edited: false, enrich_status: "done", suspended: false, has_audio: false, added_at: "2026-01-01T00:00:00Z", due_at: null,
  interval_seconds: 0, reps: 0, lapses: 0, examples: [],
});

const store = vi.hoisted(() => ({ words: [] as number[] }));
const calls = vi.hoisted(() => ({ list: [] as { offset: number; limit: number }[], bulk: [] as unknown[] }));
vi.mock("../services/api", async (orig) => ({
  ...(await orig<typeof import("../services/api")>()),
  api: {
    dictionary: vi.fn(async ({ limit = 100, offset = 0 }: { limit?: number; offset?: number }) => {
      calls.list.push({ offset, limit });
      const items = store.words.slice(offset, offset + limit).map(word);
      return { total: store.words.length, items, languages: [{ code: "de", count: store.words.length }], status_counts: { all: store.words.length, due: 0, new: store.words.length, suspended: 0 } };
    }),
    reviewSummary: vi.fn(async () => ({ total: store.words.length, due: 0, new: store.words.length, available: store.words.length })),
    bulkWords: vi.fn(async (action: string, target: { ids?: number[]; exclude?: number[] }) => {
      calls.bulk.push({ action, ...target });
      const gone = target.ids ? new Set(target.ids) : new Set(store.words.filter((w) => !target.exclude!.includes(w)));
      if (action === "delete") store.words = store.words.filter((w) => !gone.has(w));
      return { changed: gone.size };
    }),
  },
}));

// the end-of-list marker: the test says when it scrolls into view
let observed: { cb: IntersectionObserverCallback; el: Element | null }[] = [];
class FakeObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) { observed.push({ cb: this.cb, el }); }
  disconnect() { observed = observed.filter((o) => o.cb !== this.cb); }
  unobserve() {}
  takeRecords() { return []; }
}
const scrollToEnd = async (visible = true) => {
  await act(async () => { for (const o of observed) o.cb([{ isIntersecting: visible, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

let host: HTMLElement;
let root: Root;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const rows = () => document.querySelectorAll(".words > li").length;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const confirmDialog = async () => { await flush(); await click([...document.querySelectorAll<HTMLButtonElement>(".dialog button, .sheet button")].reverse().find((b) => /Remove|Reset/.test(b.textContent ?? ""))!); await flush(); };

beforeEach(async () => {
  localStorage.clear();
  observed = [];
  calls.list = [];
  calls.bulk = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const render = async (n: number) => {
  store.words = Array.from({ length: n }, (_, i) => i + 1);
  await act(async () => root.render(<ConfirmProvider><DictionaryPage /></ConfirmProvider>));
  await flush();
};

describe("the Dictionary page loads more words as the list scrolls", () => {
  it("shows the first page, then fetches only the next page while the end of the list stays in view", async () => {
    await render(250);
    expect(rows()).toBe(100);
    expect(document.body.textContent).toContain("Loading more words");
    expect(calls.list).toEqual([{ offset: 0, limit: 100 }]);
    await scrollToEnd(false); // out of view: nothing more is fetched
    expect(calls.list).toHaveLength(1);
    await scrollToEnd(); // the marker stays in view (the fake never says it left), so page after page arrives until the end
    expect(rows()).toBe(250);
    expect(calls.list).toEqual([{ offset: 0, limit: 100 }, { offset: 100, limit: 100 }, { offset: 200, limit: 100 }]);
    expect(document.querySelector(".list-end")).toBeNull(); // nothing left: no marker
  });
  it("asks for nothing more when every word fits on the first page", async () => {
    await render(30);
    expect(rows()).toBe(30);
    expect(document.querySelector(".list-end")).toBeNull();
    expect(calls.list).toHaveLength(1);
  });
});

describe("select mode on the Dictionary page", () => {
  it("removes the ticked words after asking", async () => {
    await render(5);
    await click(button("Select"));
    expect(document.querySelector(".select-bar")?.textContent).toContain("0 selected");
    expect(button("Remove").disabled).toBe(true);
    const boxes = document.querySelectorAll<HTMLInputElement>(".words .pick");
    expect(boxes).toHaveLength(5);
    await click(boxes[0]!);
    await click(document.querySelectorAll(".word-main")[2]!); // a tap on the row ticks it too, it does not open it
    expect(document.querySelector(".select-bar")?.textContent).toContain("2 selected");
    expect(document.querySelector(".word-detail")).toBeNull();
    await click(button("Remove"));
    await confirmDialog();
    expect(calls.bulk).toEqual([{ action: "delete", ids: [1, 3] }]);
    expect(document.querySelector(".select-bar")).toBeNull(); // a bulk action ends select mode
    expect(rows()).toBe(3);
    expect(document.body.textContent).toContain("Removed 2 words");
  });
  it("Select all covers the words not loaded yet and sends the filters with the unticked words", async () => {
    await render(250);
    await click(button("Select"));
    await click(document.querySelector(".select-bar .select-all")!);
    expect(document.querySelector(".select-bar strong")?.textContent).toBe("250 selected");
    await click(document.querySelectorAll<HTMLInputElement>(".words .pick")[1]!);
    expect(document.querySelector(".select-bar strong")?.textContent).toBe("249 selected");
    await click(button("More actions"));
    await click(button("Pause reviews"));
    await flush();
    expect(calls.bulk).toEqual([{ action: "pause", filter: { status: "all", language: undefined, q: undefined }, exclude: [2] }]);
    expect(document.body.textContent).toContain("Paused 249 words");
  });
  it("Reset progress asks first; the X and Esc leave select mode", async () => {
    await render(3);
    await click(button("Select"));
    await click(document.querySelectorAll(".word-main")[0]!);
    await click(button("More actions"));
    await click(button("Reset progress"));
    await confirmDialog();
    expect(calls.bulk).toEqual([{ action: "reset", ids: [1] }]);
    await click(button("Select"));
    await click(button("Cancel selection"));
    expect(document.querySelector(".select-bar")).toBeNull();
    await click(button("Select"));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector(".select-bar")).toBeNull();
  });
});
