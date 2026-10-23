import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** S 36 (queue rows), M 44 (library rows, queue bar, result card; 48 on touch), L 52 (the player) */
  size?: "s" | "m" | "l";
  /** the song is running: the button shows pause */
  playing?: boolean;
  /** another glyph in the same disc (shuffle again) */
  icon?: IconName;
}

/** The one play button (design guide section 23): a yellow disc with a dark play or pause glyph, everywhere. */
export function PlayButton({ size = "m", playing = false, icon, className, type = "button", ...rest }: Props) {
  return (
    <button type={type} className={`pbtn${className ? ` ${className}` : ""}`} data-size={size} {...rest}>
      <Icon name={icon ?? (playing ? "pauseBars" : "playArrow")} />
    </button>
  );
}
