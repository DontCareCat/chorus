import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { en } from "../i18n/en";
import type { SongDto } from "../services/api";

type Phase = "hidden" | "running" | "out" | "in" | "hold" | "leaving";
type Tier = "S" | "M" | "L";

/** How long the result stays after it has arrived (ms). */
export const HOLD_MS = 5000;
const SWEEP_MS = 700; // the colour wave crosses the bar while the old letters leave
const ARRIVE_MS = 1000; // the new letters arrive
const SLIDE_MS = 460; // the bar slides shut
const LEAVE_CAP_MS = 420; // all the old letters are gone within this
const ARRIVE_CAP_MS = 600; // all the new letters have arrived within this
const ANNOUNCE_MS = 10_000; // a screen reader hears the count at most this often

/** One run of lookups: the songs it has seen, how many it started with (growing when songs are added), and how many were waiting last time we looked. */
export interface Run { ids: number[]; total: number; last: number; at: number }

const RUN_KEY = "chorus-lookup-run";
const RUN_MAX_AGE_MS = 36 * 3600_000; // a run older than this was never finished by this screen: forget it

/** The run after a look at the list: new songs waiting raise the total, so what was done stays done. */
export function advanceRun(run: Run | null, waiting: number, pendingIds: readonly number[], now: number): Run {
  const r: Run = run ? { ...run, ids: [...run.ids] } : { ids: [], total: 0, last: 0, at: now };
  const have = new Set(r.ids);
  for (const id of pendingIds) if (!have.has(id)) r.ids.push(id);
  if (waiting > r.last) r.total += waiting - r.last;
  r.last = waiting;
  return r;
}

export function loadRun(now = Date.now()): Run | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Run;
    return Array.isArray(r.ids) && typeof r.total === "number" && now - r.at < RUN_MAX_AGE_MS ? r : null;
  } catch {
    return null;
  }
}

function saveRun(run: Run | null): void {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch { /* storage blocked: the run just lasts while this screen is open */ }
}

export interface Counts { found: number; choose: number; none: number }

/** What happened to the songs that were being looked up. */
export function resultCounts(songs: readonly SongDto[], ids: ReadonlySet<number>): Counts {
  const c = { found: 0, choose: 0, none: 0 };
  for (const s of songs) {
    if (!ids.has(s.id)) continue;
    if (s.lyrics_status === "found") c.found++;
    else if (s.lyrics_status === "needs_choice") c.choose++;
    else if (s.lyrics_status === "not_found") c.none++;
  }
  return c;
}

/** The sentence the bar ends with (the full form). */
export const resultText = (songs: readonly SongDto[], ids: ReadonlySet<number>): string => {
  const c = resultCounts(songs, ids);
  return en.library.lookupDone(c.found, c.choose, c.none);
};

/** The tier the bar's own width calls for (not the phone/PC layout: a tablet has a wide bar). */
export const tierFor = (width: number): Tier => (width < 340 ? "S" : width < 600 ? "M" : "L");

/** Thousands are separated by a thin space ("1 170"). */
export const fmt = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** The delay between letters: `step`, but never so much that the whole text takes longer than `cap`. */
export const letterStep = (step: number, cap: number, length: number): number => Math.min(step, cap / Math.max(1, length));

const reducedMotion = (): boolean => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function Letters({ text, step }: { text: string; step: number }) {
  const chars = Array.from(text);
  return <>{chars.map((ch, i) => <span key={`${text}-${i}`} className="ch" style={{ animationDelay: `${Math.round(i * step)}ms` }}>{ch}</span>)}</>;
}

const Icon22 = () => (
  <span className="lookup-icon" aria-hidden="true">
    <span className="lookup-ring" />
    <svg className="lookup-tick" viewBox="0 0 22 22"><circle cx="11" cy="11" r="10" fill="currentColor" /><path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="var(--surface-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>
);

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Found = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" {...stroke} /></svg>;
const Choose = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.7 6.2a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.8-1.1 1.6" {...stroke} /><circle cx="8" cy="12.6" r="0.6" fill="currentColor" stroke="currentColor" strokeWidth="0.6" /></svg>;
const None = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" {...stroke} /></svg>;

const RetryIcon = () => <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2" {...stroke} /></svg>;

interface Props {
  songs: readonly SongDto[];
  busy: boolean;
  onRetry: () => void;
  /** the list has been loaded (an empty list before that is not "nothing is waiting") */
  ready?: boolean;
}

/**
 * The status bar under the filters, only while lyrics requests are running or waiting (design guide section 24).
 * It slides open (the list moves down); the ring turns in the bar only; the counter "done of total" has its own slot and a progress line runs
 * along the bottom. When the last request is done a colour wave crosses the bar, the old words leave letter by letter and the result arrives
 * letter by letter; the result stays 5 s, then the bar slides shut. What the bar says depends on its own width (tier S, M, L).
 */
export function LookupBar({ songs, busy, onRetry, ready = true }: Props) {
  const waiting = songs.filter((s) => s.lyrics_status === "pending" && !s.lyrics_stalled).length;
  const [phase, setPhase] = useState<Phase>("hidden");
  const [counts, setCounts] = useState<Counts | null>(null); // set when a run is done
  const [tier, setTier] = useState<Tier>("L");
  const [midFits, setMidFits] = useState(true);
  const [announce, setAnnounce] = useState("");
  const run = useRef<Run | null>(loadRun()); // kept in storage, so leaving the page or closing the app does not reset the count
  const [, redraw] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wasWaiting = useRef(run.current !== null && run.current.last > 0); // a run that was on when we left continues (or its result is shown)
  const lastAnnounced = useRef(0);
  const latest = useRef(songs);
  latest.current = songs;
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => clear, []);

  useLayoutEffect(() => { // the tier follows the bar's width
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTier(tierFor(el.getBoundingClientRect().width)));
    ro.observe(el);
    setTier(tierFor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [phase === "hidden"]);

  useEffect(() => {
    if (!ready) return;
    if (waiting > 0) {
      const pending = songs.filter((s) => s.lyrics_status === "pending" && !s.lyrics_stalled).map((s) => s.id);
      const begins = !wasWaiting.current;
      run.current = advanceRun(begins ? null : run.current, waiting, pending, Date.now()); // a new run counts from zero
      saveRun(run.current);
      if (begins) { // a run begins (or begins again while the last result is still on show)
        wasWaiting.current = true;
        clear();
        setCounts(null);
        setPhase("running");
      } else if (phase === "hidden") {
        setPhase("running"); // the page was opened in the middle of a run
      }
      redraw((n) => n + 1);
      const now = Date.now();
      if (now - lastAnnounced.current >= ANNOUNCE_MS || lastAnnounced.current === 0) {
        lastAnnounced.current = now;
        setAnnounce(en.library.lookupStatus(Math.max(0, run.current.total - waiting), run.current.total));
      }
    } else if (!wasWaiting.current) {
      if (run.current) { run.current = null; saveRun(null); } // nothing is waiting and no run is on: forget an old one
    } else { // the last request is done
      wasWaiting.current = false;
      clear();
      const c = resultCounts(latest.current, new Set(run.current?.ids ?? []));
      const quick = reducedMotion();
      setPhase("out");
      later(quick ? 0 : SWEEP_MS, () => { setCounts(c); setPhase("in"); setAnnounce(en.library.lookupDone(c.found, c.choose, c.none)); });
      const t1 = (quick ? 0 : SWEEP_MS) + (quick ? 0 : ARRIVE_MS);
      later(t1, () => setPhase("hold"));
      later(t1 + HOLD_MS, () => setPhase("leaving"));
      later(t1 + HOLD_MS + (quick ? 0 : SLIDE_MS), () => { setPhase("hidden"); setCounts(null); setAnnounce(""); run.current = null; saveRun(null); lastAnnounced.current = 0; });
    }
  }, [waiting, songs, ready]);

  const open = phase !== "hidden" && phase !== "leaving";
  const showResult = counts !== null;
  const total = run.current?.total ?? waiting;
  const done = Math.max(0, total - waiting);
  const motion = reducedMotion() ? "" : phase === "out" ? "leave" : phase === "in" ? "arrive" : "";

  // the words the label shows (the old words stay while they leave)
  const runLabel = tier === "S" ? en.library.lookupShort : tier === "M" ? en.library.lookupMid : en.library.lookup(waiting || total);
  const resultLabel = !counts ? "" : tier === "S" ? en.library.lookupDoneShort : tier === "L" ? en.library.lookupDone(counts.found, counts.choose, counts.none) : midFits ? en.library.lookupDoneMid(counts.found, counts.choose, counts.none) : en.library.lookupDoneShort;
  const text = showResult ? resultLabel : runLabel;
  const showGroups = showResult && (tier === "S" || (tier === "M" && !midFits));

  useLayoutEffect(() => { // the M result is used only when it fits
    if (tier !== "M" || !counts) { setMidFits(true); return; }
    const el = label.current;
    if (el && el.scrollWidth > el.clientWidth + 1) setMidFits(false);
  }, [tier, counts, phase]);
  useEffect(() => { if (!counts) setMidFits(true); }, [counts]);

  if (phase === "hidden" && !announce) return null;
  const step = phase === "out" ? letterStep(14, LEAVE_CAP_MS, Array.from(text).length) : phase === "in" ? letterStep(24, ARRIVE_CAP_MS, Array.from(text).length) : 0;
  const groups: [ReactElement, number][] = counts ? ([[<Found key="f" />, counts.found], [<Choose key="c" />, counts.choose], [<None key="n" />, counts.none]] as [ReactElement, number][]).filter(([, n]) => n > 0) : [];
  return (
    <div className="lookup-slot" data-open={open} data-tier={tier}>
      <div className="lookup-clip">
        <div className="lookup-bar" data-phase={phase} data-tier={tier} ref={bar}>
          <div className="lookup-wave" aria-hidden="true" />
          <Icon22 />
          <span className={`lookup-label ${motion}`} ref={label} aria-hidden="true">{motion ? <Letters text={text} step={step} /> : text}</span>
          {showGroups && (
            <span className={`lookup-groups ${motion}`} aria-hidden="true">
              {groups.map(([icon, n], i) => <span key={i} className="lookup-group" style={{ animationDelay: `${120 + i * 90}ms` }}>{icon}<b>{fmt(n)}</b></span>)}
            </span>
          )}
          {!showResult && (
            <>
              <span className="lookup-count" aria-hidden="true">{tier === "S" ? en.library.lookupCountShort(fmt(done), fmt(total)) : en.library.lookupCount(fmt(done), fmt(total))}</span>
              {tier === "L"
                ? <button type="button" className="btn secondary small" onClick={onRetry} disabled={busy}>{en.library.lookupRetry}</button>
                : <button type="button" className="lookup-retry" onClick={onRetry} disabled={busy} aria-label={en.library.lookupRetry} title={en.library.lookupRetry}><RetryIcon /></button>}
            </>
          )}
          <div className="lookup-track" aria-hidden="true"><i style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
          <span className="sr-only" role="status" aria-live="polite">{announce}</span>
        </div>
      </div>
    </div>
  );
}
