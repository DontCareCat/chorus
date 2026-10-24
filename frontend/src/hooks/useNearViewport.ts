import { useEffect, useState } from "react";
import type { RefObject } from "react";

type Listener = (near: boolean, el: Element) => void;
const listeners = new Map<Element, Listener>();
let observer: IntersectionObserver | null = null;
const MARGIN = "1600px 0px"; // a few screens above and below: a quick scroll meets rows that are already there

const shared = (): IntersectionObserver =>
  (observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) listeners.get(e.target)?.(e.isIntersecting, e.target);
  }, { rootMargin: MARGIN }));

/**
 * Whether the element is within a few screens of the viewport. A long list renders only the rows that are near and keeps an empty
 * box of the same height for the others, so a library of thousands costs about as much as a screenful. Without IntersectionObserver
 * (old browsers, tests) everything counts as near.
 */
export function useNearViewport(ref: RefObject<HTMLElement | null>, { initially = false, enabled = true, onLeave }: { initially?: boolean; enabled?: boolean; onLeave?: (el: HTMLElement) => void } = {}): boolean {
  const supported = typeof IntersectionObserver !== "undefined";
  const [near, setNear] = useState(!supported || !enabled || initially);
  useEffect(() => {
    const el = ref.current;
    if (!el || !supported || !enabled) return;
    listeners.set(el, (isNear, target) => {
      if (!isNear) onLeave?.(target as HTMLElement);
      setNear(isNear);
    });
    shared().observe(el);
    return () => {
      listeners.delete(el);
      observer?.unobserve(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, supported, enabled]);
  return near || !enabled;
}
