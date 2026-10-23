import { useCallback, useEffect, useRef } from "react";
import { stepSpin } from "../lib/spin";
import type { Spin } from "../lib/spin";
import { reducedMotion } from "./useExitTransition";

/**
 * Turns an element like a record on a turntable (guide section 23). The angle lives here, not in CSS, so a pause freezes the record where it is
 * and the next play goes on from that angle, and its speed ramps up and down instead of jumping. The loop runs only while the record moves.
 * Returns a ref callback for the element to turn.
 */
export function useSpin(on: boolean): (node: HTMLElement | null) => void {
  const node = useRef<HTMLElement | null>(null);
  const spin = useRef<Spin>({ angle: 0, speed: 0 });
  const want = useRef(on);
  const raf = useRef(0);
  const last = useRef(0);

  const paint = () => { if (node.current) node.current.style.transform = `rotate(${spin.current.angle.toFixed(2)}deg)`; };
  const tick = useCallback((t: number) => {
    const dt = Math.min(0.05, (t - last.current) / 1000);
    last.current = t;
    spin.current = stepSpin(spin.current, dt, want.current && !reducedMotion());
    paint();
    raf.current = spin.current.speed > 0 || want.current ? requestAnimationFrame(tick) : 0;
  }, []);

  useEffect(() => {
    want.current = on;
    if (!raf.current && (on || spin.current.speed > 0) && !reducedMotion()) {
      last.current = performance.now();
      raf.current = requestAnimationFrame(tick);
    }
  }, [on, tick]);
  useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  return useCallback((el: HTMLElement | null) => { node.current = el; paint(); }, []);
}
