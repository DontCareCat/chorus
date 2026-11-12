import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { api } from "../services/api";
import { Icon } from "./Icon";

/** The recording that came with an imported Anki deck, as a play icon next to the word in a review. Press to play, press again to stop. */
export function WordAudio({ entryId }: { entryId: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { audio.current = null; setPlaying(false); return () => { audio.current?.pause(); }; }, [entryId]); // a new card brings its own recording
  const toggle = () => {
    if (playing && audio.current) { audio.current.pause(); audio.current.currentTime = 0; return; }
    void (async () => {
      const a = audio.current ?? new Audio(await api.dictionaryAudioUrl(entryId));
      audio.current = a;
      a.onplay = () => setPlaying(true);
      a.onpause = a.onended = a.onerror = () => setPlaying(false);
      await a.play().catch(() => setPlaying(false));
    })();
  };
  const label = playing ? en.dictionary.stopRecording : en.dictionary.playRecording;
  return (
    <button type="button" className="icon-btn word-audio" aria-pressed={playing} aria-label={label} title={label} onClick={toggle}>
      <Icon name={playing ? "stop" : "volumeUp"} />
    </button>
  );
}
