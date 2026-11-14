import { useEffect, useRef } from "react";
import { TICK_PX, loudAt, UNIFORM_TICK } from "../game/strip";
import type { Peaks } from "../game/strip";
import { fmtNow } from "../lib/timing-edit";
import type { Times } from "../lib/timing-edit";
import { en } from "../i18n/en";

interface Props {
  getTime: () => number;
  duration: number;
  /** seconds the strip shows in all (12 phone, 16 phone on its side, 24 PC) */
  windowSeconds: number;
  peaks: Peaks | null;
  times: Times;
  original: Times;
  /** index of the chosen line */
  sel: number;
  /** the strip was grabbed: the page pauses the audio and says whether it was playing */
  onStart: () => boolean;
  /** let go on `time` (or an arrow key): seek there, and play again if it was playing */
  onEnd: (time: number, wasPlaying: boolean) => void;
}

const HOLD_PX = 6;

/**
 * The timing editor's strip (design guide section 23, "Timing strip"): the look of the game's progress strip (loudness lines, now fixed at the centre,
 * drag to move in the song) without the lens, so the distances between lines are true. Every timed line has a marker; the chosen line's is taller
 * and carries its number. Dragging pauses the audio and it resumes on release; no coasting.
 */
export function TimingStrip(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const p = useRef(props);
  p.current = props;
  const drag = useRef<{ x: number; time: number; was: boolean; moved: boolean; current: number } | null>(null);

  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    let raf = 0, lastText = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w <= 0 || h <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { duration, windowSeconds, peaks, times, original, sel } = p.current;
      const now = drag.current ? drag.current.current : p.current.getTime();
      const cs = getComputedStyle(el);
      const col = (v: string) => cs.getPropertyValue(v).trim() || "#888";
      const text = col("--text"), accent = col("--accent"), text3 = col("--text-3"), fill = col("--fill"), onFill = col("--on-fill");
      const spp = windowSeconds / w; // even scale
      ctx.fillStyle = text;
      for (let x = 0; x < w; x += TICK_PX) {
        const t = now - windowSeconds / 2 + x * spp;
        if (t < 0 || t > duration) continue;
        const hh = 4 + (loudAt(peaks, t) ?? UNIFORM_TICK) * (h * 0.7 - 4);
        ctx.globalAlpha = t <= now ? 0.32 : 0.2;
        ctx.fillRect(x, (h - hh) / 2, 1.5, hh);
      }
      times.forEach((t, i) => {
        if (t == null || Math.abs(t - now) > windowSeconds / 2 || i === sel) return;
        const x = w / 2 + (t - now) / spp;
        const edited = t !== (original[i] ?? null);
        ctx.globalAlpha = edited ? 0.7 : 0.8;
        ctx.fillStyle = edited ? accent : text3;
        ctx.fillRect(x - 1, 12, 2, h - 24);
      });
      const st = times[sel];
      if (st != null && Math.abs(st - now) <= windowSeconds / 2) {
        const x = w / 2 + (st - now) / spp;
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.fillRect(x - 1, 20, 2, h - 20);
        const label = String(sel + 1);
        ctx.font = "800 11px Inconsolata, monospace";
        const lw = Math.max(18, ctx.measureText(label).width + 8);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(Math.min(Math.max(0, x - lw / 2), w - lw), 2, lw, 16, 5);
        ctx.fill();
        ctx.fillStyle = onFill;
        ctx.textAlign = "center";
        ctx.fillText(label, Math.min(Math.max(lw / 2, x), w - lw / 2), 14);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = text; // the playhead
      ctx.fillRect(w / 2 - 1, 0, 2, h);
      const valueText = en.timing.positionText(fmtNow(now), fmtNow(duration).replace(/\.\d$/, ""));
      if (valueText !== lastText) { lastText = valueText; el.setAttribute("aria-valuetext", valueText); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const down = (e: React.PointerEvent) => {
    const was = p.current.onStart();
    drag.current = { x: e.clientX, time: p.current.getTime(), was, moved: false, current: p.current.getTime() };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current, w = wrap.current;
    if (!d || !w) return;
    if (Math.abs(e.clientX - d.x) > HOLD_PX) d.moved = true;
    const spp = p.current.windowSeconds / w.getBoundingClientRect().width;
    d.current = Math.min(p.current.duration, Math.max(0, d.time - (e.clientX - d.x) * spp));
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    p.current.onEnd(d.current, d.was);
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const was = p.current.onStart();
    p.current.onEnd(Math.min(p.current.duration, Math.max(0, p.current.getTime() + (e.key === "ArrowLeft" ? -5 : 5))), was);
  };
  return (
    <div
      ref={wrap} className="tm-strip" role="slider" tabIndex={0} aria-label={en.timing.position} aria-valuemin={0} aria-valuemax={Math.round(props.duration)}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
    >
      <canvas ref={canvas} />
    </div>
  );
}
