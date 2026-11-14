import type { ReactNode } from "react";

interface Props {
  /** The texts the slot has to fit (game/slot.ts slotTexts); they are only measured, never seen or read. */
  sizes: readonly string[];
  className: string;
  children?: ReactNode;
  [data: `data-${string}`]: string | boolean | undefined;
}

/**
 * The place of a missing word in a lyric line. All the texts it may hold sit in one grid cell, invisible, so its width is the widest of
 * them; what is shown (the empty blank, the answered word) is in the same cell. The width does not change when the blank is answered.
 */
export function Slot({ sizes, className, children, ...rest }: Props) {
  return (
    <span className={`${className} slot`} {...rest}>
      {sizes.map((t) => <span key={t} className="slot-size" aria-hidden="true">{t}</span>)}
      <span className="slot-fill">{children}</span>
    </span>
  );
}
