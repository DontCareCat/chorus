import { describe, expect, it } from "vitest";
import { classifyInput, cleanInput, looksRight } from "./youtube-add";

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
    ["<https://youtu.be/Y7JG63IuaWs>", "video"],
    ["\"https://youtu.be/Y7JG63IuaWs\"", "video"],
    ["https://youtu.be/Y7JG63IuaWs.", "video"],
    ["mr.brightside", "search"],
    ["AC/DC", "search"],
    ["https://example.com/page", "link"],
    ["spotify:album:abc", "link"],
    ["rammstein du hast", "search"],
    ["Beyoncé", "search"],
    ["  ", "empty"],
  ])("%s is %s", (text, kind) => expect(classifyInput(text)).toBe(kind));
});

describe("looksRight", () => {
  it("accepts the song's video, refuses another song or a cover by someone else", () => {
    expect(looksRight({ title: "Du hast", artist: "Rammstein" }, { title: "Rammstein - Du Hast (Official Video)", channel: "Rammstein" })).toBe(true);
    expect(looksRight({ title: "Du hast", artist: "Rammstein" }, { title: "Du Hast - Piano Cover", channel: "Some Pianist" })).toBe(false);
    expect(looksRight({ title: "Sonne", artist: "Rammstein" }, { title: "Rammstein - Du Hast", channel: "Rammstein" })).toBe(false);
    expect(looksRight({ title: "Halo (Remastered)", artist: "Beyoncé" }, { title: "Beyonce - Halo", channel: "BeyoncéVEVO" })).toBe(true);
  });
});
describe("cleanInput", () => {
  it("takes brackets, quotes and a full stop off a link only", () => {
    expect(cleanInput("<https://youtu.be/x>")).toBe("https://youtu.be/x");
    expect(cleanInput("(Hello world)")).toBe("(Hello world)");
    expect(cleanInput("Song, Title.")).toBe("Song, Title.");
  });
});
