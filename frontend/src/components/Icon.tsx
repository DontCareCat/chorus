// Material Symbols Outlined (weight 400, optical size 24), Apache-2.0, from the @material-symbols/svg-400 package.
import pauseCircle from "@material-symbols/svg-400/outlined/pause_circle.svg?raw";
import playCircle from "@material-symbols/svg-400/outlined/play_circle.svg?raw";
import replay5 from "@material-symbols/svg-400/outlined/replay_5.svg?raw";
import stop from "@material-symbols/svg-400/outlined/stop.svg?raw";
import volumeDown from "@material-symbols/svg-400/outlined/volume_down.svg?raw";
import volumeMute from "@material-symbols/svg-400/outlined/volume_mute.svg?raw";
import volumeOff from "@material-symbols/svg-400/outlined/volume_off.svg?raw";
import volumeUp from "@material-symbols/svg-400/outlined/volume_up.svg?raw";

const pathOf = (svg: string): string => /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";

const PATHS = {
  play: pathOf(playCircle),
  pause: pathOf(pauseCircle),
  stop: pathOf(stop),
  rewind5: pathOf(replay5),
  volumeUp: pathOf(volumeUp),
  volumeDown: pathOf(volumeDown),
  volumeMute: pathOf(volumeMute),
  volumeOff: pathOf(volumeOff),
} as const;

export type IconName = keyof typeof PATHS;

/** Inline SVG icon that takes the text colour and scales with the font size. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 -960 960 960" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
