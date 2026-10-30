import { describe, expect, it } from "vitest";
import { classifyInput } from "./youtube-add";

describe("classifyInput", () => {
  it.each([
    ["https://open.spotify.com/playlist/5auhc1NwZLVFKAfywWk5kN?si=mX5KiIeuTraB2m6EQfkJ7g&utm_source=copy-link&pi=nEHz3UtfQHWoo", "spotify"],
    ["https://music.youtube.com/playlist?list=PLAw_8IRmyA1I&si=aGk2lVfrpdh--9IT", "playlist"],
    ["https://youtube.com/playlist?list=PLAw_8IRmyA1I&si=_qlnbVUb5bG0EF3J", "playlist"],
    ["https://youtu.be/Y7JG63IuaWs?is=WHfP__H3h4JUxUCl", "video"],
    ["youtu.be/Y7JG63IuaWs", "video"],
    ["www.youtube.com/watch?v=Y7JG63IuaWs&list=PLAw_8IRmyA1I", "video"],
    ["https://music.youtube.com/watch?v=Y7JG63IuaWs", "video"],
    ["https://open.spotify.com/track/5QRkWkMabF6HJmQQm2HBVX?si=abc", "spotifyTrack"],
    ["spotify:track:5QRkWkMabF6HJmQQm2HBVX", "spotifyTrack"],
    ["https://example.com/page", "link"],
    ["spotify:album:abc", "link"],
    ["rammstein du hast", "search"],
    ["Beyoncé", "search"],
    ["  ", "empty"],
  ])("%s is %s", (text, kind) => expect(classifyInput(text)).toBe(kind));
});
