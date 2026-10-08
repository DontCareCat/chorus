import { useEffect, useRef, useState } from "react";
import { volumeIcon } from "../game/volume";
import { Icon } from "./Icon";
import { en } from "../i18n/en";
import type { PlaybackStateName } from "../game/playback-state-machine";

interface Props {
  engineReady: boolean;
  state: PlaybackStateName;
  time: number;
  duration: number;
  onStart: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onBack: () => void;
  /** Resolves when the seek is done, so the thumb can show the real position again. */
  onSeek: (time: number) => Promise<unknown>;
  /** The player's volume (shown on desktop only; phones have hardware volume keys). */
  volume: { level: number; muted: boolean; set: (v: number) => void; toggleMute: () => void; step: (d: 1 | -1) => void };
}

const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function Transport({ engineReady, state, time, duration, onStart, onPlay, onPause, onStop, onBack, onSeek, volume }: Props) {
  const running = state === "PLAYING" || state === "FADING_IN" || state === "FADING_OUT";
  // While the thumb is being dragged it shows the drag position; the seek happens when it is released.
  const [dragging, setDragging] = useState<number | null>(null);
  const commit = () => {
    if (dragging === null) return;
    // keep showing the target until the seek is done: no jump back to the old position and forward again
    void onSeek(dragging).finally(() => setDragging(null));
  };
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
  return (
    <div className="transport">
      <div className="transport-inner">
        <div className="controls" role="group" aria-label="Playback">
          <button type="button" className="icon-btn" onClick={onBack} disabled={!engineReady} aria-label={en.game.back5} title={en.game.back5}>
            <Icon name="rewind5" />
          </button>
          {running ? (
            <button type="button" className="icon-btn big" onClick={onPause} aria-label={en.game.pause} title={en.game.pause}>
              <Icon name="pause" />
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn big"
              onClick={engineReady ? onPlay : onStart}
              disabled={state === "SEEKING"}
              aria-label={en.game.play}
              title={en.game.play}
            >
              <Icon name="play" />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onStop} disabled={!engineReady} aria-label={en.game.stop} title={en.game.stop}>
            <Icon name="stop" />
          </button>
        </div>
        <input
          className="seek"
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={dragging ?? Math.min(time, Math.max(duration, 1))}
          disabled={!engineReady || duration <= 0}
          aria-label={en.game.position}
          aria-valuetext={`${mmss(dragging ?? time)} of ${mmss(duration)}`}
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={(e) => e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" ? commit() : undefined}
          onBlur={commit}
        />
        <div className="volume" ref={volumeBox} role="group" aria-label={en.game.volume}>
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
            aria-label={en.game.volume}
            aria-valuetext={`${Math.round(shown * 100)}%`}
            onChange={(e) => volume.set(Number(e.target.value))}
          />
        </div>
        <span className="transport-time" aria-hidden="true">{mmss(dragging ?? time)} / {mmss(duration)}</span>
      </div>
    </div>
  );
}
