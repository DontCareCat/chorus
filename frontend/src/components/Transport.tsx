import { useEffect, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { volumeIcon } from "../game/volume";
import { Icon } from "./Icon";
import { PlayButton } from "./PlayButton";
import { ProgressStrip } from "./ProgressStrip";
import type { StripHandle } from "./ProgressStrip";
import { WINDOW_PHONE_S, WINDOW_WIDE_S } from "../game/strip";
import type { Peaks, StripLine } from "../game/strip";
import { en } from "../i18n/en";
import type { PlaybackStateName } from "../game/playback-state-machine";

interface Props {
  engineReady: boolean;
  state: PlaybackStateName;
  /** the song's position now (read every frame by the strip) */
  getTime: () => number;
  duration: number;
  onStart: () => void;
  onPlay: () => void;
  onPause: () => void;
  /** a touch screen (guide section 11): no volume control, a 24 s window */
  phone: boolean;
  /** the play queue: how many songs wait, and open its list */
  queue?: { count: number; onOpen: () => void };
  /** the strip: one line per lyric line with questions, the loudness, how far forward a scrub may go, and what a scrub does */
  lines: readonly StripLine[];
  peaks: Peaks | null;
  limit: number;
  onScrubStart: () => { wasPlaying: boolean } | null;
  onScrubEnd: (time: number, wasPlaying: boolean) => Promise<unknown>;
  onGate: () => void;
  strip?: Ref<StripHandle>;
  volume: { level: number; muted: boolean; set: (v: number) => void; toggleMute: () => void; step: (d: 1 | -1) => void };
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const f = () => setOn(list.matches);
    list.addEventListener("change", f);
    return () => list.removeEventListener("change", f);
  }, [query]);
  return on;
}

export function Transport({ engineReady, state, getTime, duration, onStart, onPlay, onPause, phone, volume, queue, lines, peaks, limit, onScrubStart, onScrubEnd, onGate, strip }: Props) {
  const running = state === "PLAYING" || state === "FADING_IN" || state === "FADING_OUT";
  // the mouse wheel over the volume control changes the volume (a non-passive listener, so the page does not scroll)
  const volumeBox = useRef<HTMLDivElement>(null);
  const stepRef = useRef(volume.step);
  stepRef.current = volume.step;
  useEffect(() => {
    const el = volumeBox.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const shown = volume.muted ? 0 : volume.level;
  const sideways = useMedia("(orientation: landscape) and (max-height: 500px)"); // a phone on its side: one thin row, the PC's 60 s window
  return (
    <div className="transport">
      <div className="transport-inner">
        <div className="controls" role="group" aria-label="Playback">
          <PlayButton
            size="l"
            playing={running}
            onClick={running ? onPause : engineReady ? onPlay : onStart}
            disabled={!running && state === "SEEKING"}
            aria-label={running ? en.game.pause : en.game.play}
            title={running ? en.game.pause : en.game.play}
          />
        </div>
        <ProgressStrip
          ref={strip}
          getTime={getTime}
          duration={duration}
          lines={lines}
          limit={limit}
          waiting={state === "PAUSED_FOR_QUESTION"}
          peaks={peaks}
          enabled={engineReady && duration > 0 && state !== "ERROR"}
          windowSeconds={phone && !sideways ? WINDOW_PHONE_S : WINDOW_WIDE_S}
          onStart={onScrubStart}
          onEnd={onScrubEnd}
          onGate={onGate}
        />
        {!phone && <div className="volume" ref={volumeBox} role="group" aria-label={en.game.volume}>
          <button
            type="button"
            className="icon-btn"
            onClick={volume.toggleMute}
            aria-pressed={volume.muted}
            aria-label={volume.muted ? en.game.unmute : en.game.mute}
            title={`${volume.muted ? en.game.unmute : en.game.mute} (M)`}
          >
            <Icon name={volumeIcon(volume.level, volume.muted)} />
          </button>
          <input
            className="volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={shown}
            style={{ "--p": `${shown * 100}%` } as CSSProperties}
            aria-label={en.game.volume}
            aria-valuetext={`${Math.round(shown * 100)}%`}
            onChange={(e) => volume.set(Number(e.target.value))}
          />
        </div>}
        {queue && (
          <button type="button" className="icon-btn queue-btn" onClick={queue.onOpen} aria-label={en.queue.openList} title={en.queue.openList}>
            <Icon name="queue" />
            {queue.count > 0 && <small className="queue-count" aria-hidden="true">{queue.count}</small>}
          </button>
        )}
      </div>
    </div>
  );
}
