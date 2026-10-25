import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import type { SongDto } from "../services/api";

type Phase = "hidden" | "running" | "out" | "in" | "hold" | "leaving";

/** How long the result stays after the sweep (ms). */
export const HOLD_MS = 5000;
const SWEEP_MS = 700; // the colour wave crosses the bar while the old letters leave
const ARRIVE_MS = 1000; // the new letters arrive
const SLIDE_MS = 460; // the bar slides shut

/** What happened to the songs that were being looked up: the sentence the bar ends with. */
export function resultText(songs: readonly SongDto[], ids: ReadonlySet<number>): string {
  let found = 0, choose = 0, none = 0;
  for (const s of songs) {
    if (!ids.has(s.id)) continue;
    if (s.lyrics_status === "found") found++;
    else if (s.lyrics_status === "needs_choice") choose++;
    else if (s.lyrics_status === "not_found") none++;
  }
  return en.library.lookupDone(found, choose, none);
}

const letters = (text: string, step: number) => Array.from(text).map((ch, i) => ({ ch, delay: i * step }));

interface Props {
  songs: readonly SongDto[];
  busy: boolean;
  onRetry: () => void;
}

/**
 * The status bar under the filters, only while lyrics requests are running or waiting (design: "Lyrics lookup bar animation").
 * It slides open (the list moves down), the spinner turns in the bar only, and when the last request is done a colour wave crosses it,
 * the old words leave letter by letter and the result arrives letter by letter; the result stays 5 s, then the bar slides shut.
 */
export function LookupBar({ songs, busy, onRetry }: Props) {
  const waiting = songs.filter((s) => s.lyrics_status === "pending" && !s.lyrics_stalled).length;
  const [phase, setPhase] = useState<Phase>("hidden");
  const [text, setText] = useState("");
  const ids = useRef(new Set<number>()); // the songs this run looked at
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wasWaiting = useRef(false);
  const latest = useRef(songs);
  latest.current = songs;
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => clear, []);

  useEffect(() => {
    if (waiting > 0) {
      for (const s of songs) if (s.lyrics_status === "pending" && !s.lyrics_stalled) ids.current.add(s.id);
      if (!wasWaiting.current) { // a run begins (or begins again while the last result is still on show)
        wasWaiting.current = true;
        clear();
        setPhase("running");
      }
      setText(en.library.lookup(waiting));
    } else if (wasWaiting.current) { // the last request is done
      wasWaiting.current = false;
      clear();
      setPhase("out");
      later(SWEEP_MS, () => { setText(resultText(latest.current, ids.current)); setPhase("in"); });
      later(SWEEP_MS + ARRIVE_MS, () => setPhase("hold"));
      later(SWEEP_MS + ARRIVE_MS + HOLD_MS, () => setPhase("leaving"));
      later(SWEEP_MS + ARRIVE_MS + HOLD_MS + SLIDE_MS, () => { setPhase("hidden"); ids.current = new Set(); });
    }
  }, [waiting, songs]);

  const open = phase !== "hidden" && phase !== "leaving";
  const chars = letters(text, phase === "out" ? 14 : phase === "in" ? 24 : 0);
  const motion = phase === "out" ? "leave" : phase === "in" ? "arrive" : "";
  if (phase === "hidden" && !text) return null;
  return (
    <div className="lookup-slot" data-open={open}>
      <div className="lookup-clip">
        <div className="lookup-bar" data-phase={phase} role="status" aria-live="polite">
          <div className="lookup-wave" />
          <div className="lookup-icon">
            <span className="lookup-ring" />
            <svg className="lookup-tick" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="currentColor" /><path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <span className={`lookup-text ${motion}`} aria-label={text}>
            {chars.map((c, i) => <span key={`${text}-${i}`} className="ch" style={{ animationDelay: `${c.delay}ms` }} aria-hidden="true">{c.ch}</span>)}
          </span>
          {phase === "running" && <button type="button" className="btn secondary small" onClick={onRetry} disabled={busy}>{en.library.lookupRetry}</button>}
        </div>
      </div>
    </div>
  );
}
