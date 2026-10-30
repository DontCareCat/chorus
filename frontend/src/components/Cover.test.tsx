// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Cover } from "./Cover";
import { buildMatcher } from "../lib/search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("a YouTube song", () => {
  it("shows the video's thumbnail from YouTube, even though it has no stored cover", () => {
    const host = document.createElement("div");
    act(() => createRoot(host).render(<Cover songId={1} title="Du Hast" hasCover={false} youtubeId="dQw4w9WgXcQ" />));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  });
  it("is found by search although it has no file name", () => {
    expect(buildMatcher("hast", false).test({ title: "Du Hast", artist: "Rammstein", album: null, file_name: null })).toBe(true);
  });
});
