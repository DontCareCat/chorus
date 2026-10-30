// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTopicChannel, readAddTab, startTab, writeAddTab, youtubeThumb, youtubeWatchUrl } from "./youtube-add";

beforeEach(() => localStorage.clear());

describe("add tab memory", () => {
  it("remembers the last tab", () => {
    expect(readAddTab()).toBeNull();
    writeAddTab("folder");
    expect(readAddTab()).toBe("folder");
    expect(startTab(true)).toBe("folder");
  });
  it("ignores junk and starts on YouTube", () => {
    localStorage.setItem("chorus-add-tab", "nonsense");
    expect(readAddTab()).toBeNull();
    expect(startTab(true)).toBe("youtube");
  });
  it("skips YouTube while it is switched off", () => {
    writeAddTab("youtube");
    expect(startTab(false)).toBe("files");
  });
  it("survives blocked storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readAddTab()).toBeNull();
    expect(() => writeAddTab("files")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("helpers", () => {
  it("builds the urls", () => {
    expect(youtubeThumb("abc")).toBe("https://i.ytimg.com/vi/abc/mqdefault.jpg");
    expect(youtubeWatchUrl("abc")).toBe("https://www.youtube.com/watch?v=abc");
  });
  it("knows topic channels", () => {
    expect(isTopicChannel("Nena - Topic")).toBe(true);
    expect(isTopicChannel("Nena")).toBe(false);
    expect(isTopicChannel(null)).toBe(false);
  });
});
