import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { holdDialogOpen } from "../lib/dialog-open";
import { noAutofill } from "../lib/noAutofill";
import { checkService, saveService } from "../lib/lyrics-source";

export const DEFAULT_SERVICE = "https://lrclib.net";
export const SKIP_KEY = "chorus-lyrics-source-skipped";

/**
 * The startup window for the administrator while no lyrics service is set (design guide section 12): the address of an LRCLIB-compatible
 * service, lrclib.net with one tap. "Skip this time" closes it for this run. It never closes on a click outside; Esc skips.
 */
export function LyricsSourceWindow({ onDone }: { onDone: (toast: string) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const title = "lyrics-source-title";
  const typed = url.trim() !== "";
  const skip = () => { try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* no storage: it shows again at the next start anyway */ } onDone(en.lyricsSource.skipped); };
  const skipRef = useRef(skip);
  skipRef.current = skip;
  useEffect(() => {
    field.current?.focus();
    const release = holdDialogOpen();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") skipRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); release(); };
  }, []);
  const save = async (value: string) => {
    try {
      await saveService(value);
      onDone(en.lyricsSource.saved);
    } catch (e) {
      setState("idle");
      setSaveError(e instanceof Error ? e.message : en.errors.generic);
    }
  };
  const use = async (check: boolean) => {
    const value = typed ? url.trim() : DEFAULT_SERVICE;
    setSaveError(null);
    if (check) {
      setState("checking");
      try {
        const r = await checkService(value);
        if (!r.ok) { setState("failed"); return; }
      } catch { setState("failed"); return; }
    }
    await save(value);
  };
  return (
    <div className="dialog-scrim ls-scrim">
      <div className="ls-window" role="dialog" aria-modal="true" aria-labelledby={title}>
        <div className="ls-tile" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>
        </div>
        <h2 id={title}>{en.lyricsSource.title}</h2>
        <p className="ls-lead">{en.lyricsSource.lead}</p>
        <div className="ls-field">
          <label htmlFor="ls-url">{en.lyricsSource.field}</label>
          <input id="ls-url" ref={field} type="url" inputMode="url" {...noAutofill("lyrics-source")} placeholder={DEFAULT_SERVICE} value={url} aria-describedby="ls-help"
            onChange={(e) => { setUrl(e.target.value); if (state === "failed") setState("idle"); setSaveError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && state !== "checking") void use(true); }} />
          <small id="ls-help">{en.lyricsSource.help}</small>
        </div>
        {state === "failed" && <p className="ls-hint" role="alert">{en.lyricsSource.failedHelp}</p>}
        {saveError && <p className="ls-hint" role="alert">{saveError}</p>}
        <button type="button" className="ls-big" onClick={() => void use(state !== "failed")} disabled={state === "checking"} aria-busy={state === "checking"}>
          {state === "checking" && <span className="ls-spin" aria-hidden="true" />}
          {state === "checking" ? en.lyricsSource.checking : state === "failed" ? en.lyricsSource.useAnyway : typed ? en.lyricsSource.useSpecified : en.lyricsSource.useDefault}
        </button>
        <p className="ls-disc">{en.lyricsSource.disclaimer}</p>
        <button type="button" className="ls-skip" onClick={skip}>{en.lyricsSource.skip}</button>
      </div>
    </div>
  );
}
