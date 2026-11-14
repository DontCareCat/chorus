import { useEffect, useState } from "react";
import { SKIP_KEY } from "../components/LyricsSourceWindow";
import { loadService } from "../lib/lyrics-source";

/** True while the administrator should be asked to choose a lyrics service: none is set and the window was not skipped in this run. */
export function useLyricsSourcePrompt(admin: boolean, enabled = true): [boolean, (v: boolean) => void] {
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!admin || !enabled) return;
    try { if (sessionStorage.getItem(SKIP_KEY)) return; } catch { /* no storage: ask */ }
    let live = true;
    loadService().then((url) => live && setAsk(url.trim() === ""), () => undefined);
    return () => { live = false; };
  }, [admin, enabled]);
  return [ask, setAsk];
}
