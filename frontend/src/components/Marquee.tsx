import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const GAP = 40; // px between the end of the text and its repeat
const SPEED = 36; // px per second

/**
 * One line of text that stays still when it fits and otherwise runs round as a looped strip (queue bar). The text is
 * measured after every render and when the box is resized; the copy for the loop is hidden from screen readers.
 * With reduced motion the strip does not run and the line is cut off with an ellipsis instead.
 */
export function Marquee({ children }: { children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [run, setRun] = useState<{ shift: number } | null>(null);
  const measure = () => {
    const b = box.current, t = text.current;
    if (!b || !t) return;
    const over = t.scrollWidth > b.clientWidth + 1;
    setRun((r) => (over ? (r && r.shift === t.scrollWidth + GAP ? r : { shift: t.scrollWidth + GAP }) : r === null ? r : null));
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (box.current) ro?.observe(box.current);
    return () => ro?.disconnect();
  }, []);
  return (
    <span className="marquee" ref={box} data-run={run ? "true" : undefined}>
      <span className="marquee-track" style={run ? ({ "--marquee-shift": `${run.shift}px`, "--marquee-time": `${Math.max(6, run.shift / SPEED)}s` } as React.CSSProperties) : undefined}>
        <span className="marquee-text" ref={text}>{children}</span>
        {run && <span className="marquee-text" aria-hidden="true">{children}</span>}
      </span>
    </span>
  );
}
