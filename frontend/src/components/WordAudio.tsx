import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";

/** The recording that came with an imported Anki deck. Plays on press, press again to stop. */
export function WordAudio({ entryId }: { entryId: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const toggle = () => {
    if (playing && audio.current) { audio.current.pause(); audio.current.currentTime = 0; return; }
    const a = audio.current ?? new Audio(`/api/dictionary/${entryId}/audio`);
    audio.current = a;
    a.onplay = () => setPlaying(true);
    a.onpause = a.onended = a.onerror = () => setPlaying(false);
    void a.play().catch(() => setPlaying(false));
  };
  return (
    <button type="button" className="btn secondary small" aria-pressed={playing} onClick={toggle}>
      {playing ? en.dictionary.stopRecording : en.dictionary.playRecording}
    </button>
  );
}
