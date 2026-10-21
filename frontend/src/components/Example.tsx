import { en } from "../i18n/en";
import { highlight } from "../lib/highlight";
import type { Snippets } from "../hooks/useSnippets";
import type { DictExampleDto } from "../services/api";

/** One song line a word appeared in: the sentence with the word marked, its translation, and a play button for just that line. */
export function Example({ ex, word, snippets }: { ex: DictExampleDto; word: string; snippets: Snippets }) {
  const key = `ex-${ex.id}`;
  const on = snippets.playing === key;
  const canPlay = ex.playable && ex.audio_start !== null && ex.audio_end !== null;
  return (
    <li className="example">
      <button
        type="button" className="snippet-btn" data-playing={on} disabled={!canPlay}
        aria-label={`${on ? en.dictionary.stop : en.dictionary.play}: ${ex.sentence}`} title={canPlay ? (on ? en.dictionary.stop : en.dictionary.play) : en.dictionary.unavailable}
        onClick={() => canPlay && snippets.toggle(key, { songId: ex.song_id, start: ex.audio_start!, end: ex.audio_end! })}
      />
      <div className="example-text">
        <p lang="und" className="sentence">{highlight(ex.sentence, word).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>
        {ex.translation && <p className="translation">{ex.translation}</p>}
        <p className="from">{ex.song_title}</p>
      </div>
    </li>
  );
}
