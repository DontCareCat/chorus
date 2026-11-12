// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import { LyricWindow } from "./LyricWindow";
import type { WindowLine } from "../game/lyric-window";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
Element.prototype.scrollTo = () => undefined;

const lines: WindowLine[] = [
  { lineId: 1, text: "sobre el río de papel", startTime: 1, parts: [{ kind: "text", text: "sobre el río de papel" }], targetId: null, status: "plain" },
  {
    lineId: 2, text: "y tu voz se … entre el humo", startTime: 5, targetId: 10, status: "open",
    parts: [{ kind: "text", text: "y tu voz se " }, { kind: "blank", index: 0, focused: true }, { kind: "text", text: " entre el humo" }],
  },
];
let host: HTMLElement;
let root: Root;
const onFocus = vi.fn();
const onWord = vi.fn();
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); onFocus.mockReset(); onWord.mockReset(); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });
const show = (withWord = true) => act(async () => root.render(<LyricWindow lines={lines} current={0} playing={0} asked={1} synced onFocus={onFocus} pulse={0} onWord={withWord ? onWord : undefined} />));
const tap = (word: string) => act(async () => { [...document.querySelectorAll<HTMLElement>(".lw-tap")].find((e) => e.textContent === word)!.click(); });

describe("tapping a lyric word", () => {
  it("reports the word with the whole line it is in", async () => {
    await show();
    await tap("río");
    expect(onWord).toHaveBeenCalledTimes(1);
    expect(onWord.mock.calls[0]![0]).toMatchObject({ word: "río", line: "sobre el río de papel" });
  });

  it("on a line with a question gives the line with the blank as dots and never moves the question (a word tap answers nothing)", async () => {
    await show();
    await tap("humo");
    expect(onWord.mock.calls[0]![0]).toMatchObject({ word: "humo", line: "y tu voz se … entre el humo" });
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("makes the blank itself untappable, so the answer cannot be looked up", async () => {
    await show();
    expect(document.querySelectorAll(".lw-blank .lw-tap").length).toBe(0);
  });

  it("leaves the words as plain text when nobody listens", async () => {
    await show(false);
    expect(document.querySelectorAll(".lw-tap").length).toBe(0);
  });
});
