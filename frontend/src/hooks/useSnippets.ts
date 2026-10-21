import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { SnippetPlayer } from "../lib/snippet";
import type { Snippet } from "../lib/snippet";

export interface Snippets {
  /** The key of the sentence that is playing, or null. */
  playing: string | null;
  toggle: (key: string, snippet: Snippet) => void;
  /** Set when the browser refused to play (so the page can say so). */
  blocked: boolean;
}

/** One audio element for the whole page: a sentence plays from its start to its end, one at a time. */
export function useSnippets(): Snippets {
  const player = useRef<SnippetPlayer | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    const p = new SnippetPlayer(audio, api.audioUrl);
    const off = p.onChange(setPlaying);
    player.current = p;
    return () => {
      off();
      p.stop();
      audio.removeAttribute("src");
      player.current = null;
    };
  }, []);

  return {
    playing,
    blocked,
    toggle: (key, snippet) => {
      void player.current?.toggle(key, snippet).then((ok) => setBlocked(!ok));
    },
  };
}
