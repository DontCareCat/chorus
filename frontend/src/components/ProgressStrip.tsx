import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Ref } from "react";
import { Scrub } from "../game/scrub";
import { layoutStrip, mmss, timeLeft } from "../game/strip";
import type { LineResult, Peaks, StripLine } from "../game/strip";
import { en } from "../i18n/en";

export interface StripHandle {
  /** ±seconds from the keyboard (arrow keys anywhere in the game): the same fade-out / seek / fade-in as a drag */
  nudge: (seconds: number) => void;
}

interface Props {
  ref?: Ref<StripHandle>;
  /** the song's position, read from the engine every frame */
  getTime: () => number;
  duration: number;
  lines: readonly StripLine[];
  /** how far forward a scrub may go (the first open question + grace) */
  limit: number;
  /** the game waits for an answer: the playhead turns accent */
  waiting: boolean;
  peaks: Peaks | null;
  enabled: boolean;
  /** seconds the strip shows in all (24 on a phone, 60 elsewhere) */
  windowSeconds: number;
  onStart: () => { wasPlaying: boolean } | null;
  onEnd: (time: number, wasPlaying: boolean) => Promise<unknown>;
  onGate: () => void;
}

const RESULT_VAR: Record<LineResult, string> = { open: "--text", correct: "--correct", wrong: "--wrong", almost: "--almost" };
const BLEND_MS = 200;

/**
 * The player's progress strip (design guide section 23): a window onto the song with now fixed at the centre, drawn on a canvas once per frame, plus
 * the time left to its right. The song slides under the playhead; dragging it (touch, mouse, trackpad sideways) scrubs.
 */
export function ProgressStrip(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const p = useRef(props);
  p.current = props;
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const scrub = useRef<Scrub | null>(null);
  if (!scrub.current) {
    scrub.current = new Scrub({
      time: () => p.current.getTime(),
      duration: () => p.current.duration,
      limit: () => p.current.limit,
      width: () => size.current.w || 184,
      halfWindow: () => p.current.windowSeconds / 2,
      start: () => p.current.onStart(),
      end: (t, was) => p.current.onEnd(t, was),
      onGate: () => p.current.onGate(),
      reducedMotion: () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    });
  }
  useImperativeHandle(props.ref, () => ({ nudge: (s: number) => { if (p.current.enabled) scrub.current?.nudge(s); } }), []);

  useLayoutEffect(() => { if (timeEl.current) timeEl.current.textContent = timeLeft(p.current.duration, p.current.getTime()); }, []); // the first frame already has its text

  useEffect(() => {
    const el = wrap.current, cv = canvas.current, s = scrub.current;
    if (!el || !cv || !s) return;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size.current = { w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
    });
    ro?.observe(el);
    const r0 = el.getBoundingClientRect();
    size.current = { w: r0.width, h: r0.height, dpr: window.devicePixelRatio || 1 };

    let colors: Record<string, string> = {};
    const readColors = () => {
      const cs = getComputedStyle(el);
      colors = {};
      for (const v of ["--text", "--correct", "--wrong", "--almost", "--accent"]) colors[v] = cs.getPropertyValue(v).trim() || "#888";
    };
    readColors();
    let peaksSince = 0, hadPeaks = false, n = 0, last = performance.now(), raf = 0, shownText = timeEl.current?.textContent ?? "", shownBubble = "";
    const frame = (at: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, at - last);
      last = at;
      const q = p.current;
      s.frame(dt);
      const busy = s.target !== null;
      const now = Math.max(0, Math.min(q.duration, s.target ?? q.getTime()));
      if (el.dataset.busy !== String(busy)) el.dataset.busy = String(busy);
      const t = timeEl.current;
      const text = timeLeft(q.duration, now);
      if (t) { if (text !== shownText) { t.textContent = text; shownText = text; } if (t.dataset.busy !== String(busy)) t.dataset.busy = String(busy); }
      const b = bubble.current;
      if (b) {
        const delta = Math.round(now - s.from);
        const bt = busy ? `${mmss(now)} · ${delta >= 0 ? "+" : "−"}${Math.abs(delta)} s` : "";
        if (bt !== shownBubble) { b.textContent = bt; shownBubble = bt; b.hidden = !busy; }
      }
      const { w, h, dpr } = size.current;
      const ctx = cv.getContext("2d");
      if (!ctx || w < 4 || h < 4) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      if (++n % 30 === 0) readColors();
      if (q.peaks && !hadPeaks) { hadPeaks = true; peaksSince = at; }
      if (!q.peaks) hadPeaks = false;
      const blend = q.peaks ? Math.min(1, (at - peaksSince) / BLEND_MS) : 0;
      const { ticks, marks } = layoutStrip({ now, duration: q.duration, width: w, height: h, halfWindow: q.windowSeconds / 2, peaks: q.peaks, lines: q.lines, blend });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors["--text"]!;
      for (const k of ticks) { ctx.globalAlpha = k.o; ctx.beginPath(); ctx.roundRect(k.x, k.y, 1.5, k.h, 0.75); ctx.fill(); }
      for (const m of marks) {
        ctx.globalAlpha = m.o;
        ctx.fillStyle = colors[RESULT_VAR[m.result]]!;
        ctx.beginPath(); ctx.roundRect(m.x - 1, m.y, 2, m.h, 1); ctx.fill();
        if (m.cap) { ctx.fillStyle = colors["--accent"]!; ctx.beginPath(); ctx.roundRect(m.x - 3, Math.max(0, m.y - 4), 6, 4, 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = q.waiting && !busy ? colors["--accent"]! : colors["--text"]!;
      ctx.beginPath(); ctx.roundRect(w / 2 - 1, 0, 2, h, 1); ctx.fill();
    };
    raf = requestAnimationFrame(frame);

    const down = (e: PointerEvent) => {
      if (!p.current.enabled || (e.pointerType === "mouse" && e.button !== 0)) return;
      el.setPointerCapture?.(e.pointerId);
      s.down(e.clientX, e.timeStamp);
    };
    const move = (e: PointerEvent) => s.move(e.clientX, e.timeStamp);
    const up = (e: PointerEvent) => { s.up(e.timeStamp); el.releasePointerCapture?.(e.pointerId); };
    const cancel = () => s.cancel();
    let wheelX = 0, wheelTimer: ReturnType<typeof setTimeout> | undefined, wheeling = false;
    const wheel = (e: WheelEvent) => {
      if (!p.current.enabled || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (!wheeling) { wheeling = true; wheelX = 0; s.down(0, e.timeStamp); }
      wheelX -= e.deltaX;
      s.move(wheelX, e.timeStamp);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheeling = false; s.up(Number.POSITIVE_INFINITY); }, 140); // the trackpad has its own inertia: no coasting on top
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      clearTimeout(wheelTimer);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
      s.dispose();
    };
  }, []);

  const { duration, enabled } = props;
  const t = Math.max(0, Math.min(duration, props.getTime()));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!enabled) return;
    const s = scrub.current!;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") s.nudge(e.key === "ArrowRight" ? 5 : -5);
    else if (e.key === "Home") s.jump(0);
    else if (e.key === "End") s.jump(duration);
    else return;
    e.preventDefault();
    e.stopPropagation(); // the game's own arrow keys must not seek a second time
  };
  return (
    <>
      <div
        ref={wrap}
        className="strip"
        role="slider"
        tabIndex={enabled ? 0 : -1}
        aria-label={en.game.position}
        aria-disabled={!enabled}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${mmss(t)} of ${mmss(duration)}, ${timeLeft(duration, t).slice(1)} left`}
        data-waiting={props.waiting || undefined}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvas} aria-hidden="true" />
        <div className="strip-bubble" ref={bubble} aria-hidden="true" hidden />
      </div>
      <span className="transport-time" ref={timeEl} aria-hidden="true" />
    </>
  );
}
