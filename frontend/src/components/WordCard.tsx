import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { swallowNextClick } from "../lib/swallow-click";
import { api, ApiError } from "../services/api";
import type { WordLookupDto } from "../services/api";
import { paths } from "../router";
import { Icon } from "./Icon";
import type { WordHit } from "./LyricWindow";

const MARGIN = 16;
const MAX_W = 360;
const GAP = 10;

/** "noun · m" for the card's type line. */
export function typeLine(info: Pick<WordLookupDto, "pos" | "article">): string {
  const pos = info.pos ? (en.wordCard.pos[info.pos] ?? info.pos) : "";
  return pos;
}

/**
 * The word card (item 23): a tapped lyric word, in an inverse bubble like the lyrics-status one, with an arrow on the word. Headword, type,
 * meaning, the sung line with its translation and a button that adds the word to the dictionary (the + turns into a check). The game is paused
 * by the page while the card is open; a tap anywhere else closes it (and does nothing else), and the page resumes the song.
 */
export function WordCard({ hit, language, songId, onClose }: { hit: WordHit; language: string; songId: number; onClose: () => void }) {
  const [info, setInfo] = useState<WordLookupDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; arrow: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const was = useRef(false); // in the dictionary before the card opened: a tap on the check opens the entry

  useEffect(() => {
    let gone = false;
    api.lookupWord(language, hit.word, songId, hit.line).then(
      (r) => { if (gone) return; setInfo(r); was.current = r.entry_id !== null; setAdded(r.entry_id !== null); },
      () => { if (!gone) setFailed(true); },
    );
    return () => { gone = true; };
  }, [language, hit.word, hit.line, songId]);

  useLayoutEffect(() => {
    const width = Math.min(MAX_W, window.innerWidth - 2 * MARGIN);
    const centre = hit.rect.left + hit.rect.width / 2;
    const left = Math.min(Math.max(MARGIN, centre - width / 2), window.innerWidth - MARGIN - width);
    const arrow = Math.min(Math.max(centre - left - 7, 18), width - 32);
    const below = window.innerHeight - hit.rect.bottom > 260 || hit.rect.top < 260; // room under the word, else above it
    setBox(below ? { left, width, top: hit.rect.bottom + GAP, arrow } : { left, width, bottom: window.innerHeight - hit.rect.top + GAP, arrow });
  }, [hit]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (card.current?.contains(e.target as Node)) return;
      swallowNextClick(); // the tap that closes the card must not answer a question or move the lyrics
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [onClose]);

  const add = async () => {
    if (added || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addWord({ language, word: hit.word, song_id: songId, line: hit.line, source: "tap" });
      setAdded(true);
      setPop(true);
      setTimeout(() => setPop(false), 180);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const t = en.wordCard;
  const head = info?.headword ?? hit.word;
  const status = error ?? (failed ? t.noConnection : !info ? t.looking : info.offline ? t.noConnection : added ? t.added : t.paused);
  if (!box) return null;
  const above = box.bottom !== undefined;
  return (
    <div
      ref={card} className="word-card" role="dialog" aria-label={head} data-above={above || undefined}
      style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
    >
      <i className="arrow" style={{ left: box.arrow }} aria-hidden="true" />
      <div className="wc-top">
        <div className="wc-head">
          <div className="wc-word" lang={language}><strong>{head}</strong>{info?.pos && <span className="wc-pos">{typeLine(info)}</span>}</div>
          <div className="wc-meaning">{info?.translation ?? (info && !info.offline ? t.noMeaning : "")}</div>
        </div>
        <button
          type="button" className="wc-add" data-pop={pop || undefined} aria-label={added ? t.addedLabel : t.addLabel} aria-pressed={added}
          disabled={busy} onClick={() => { if (was.current) { window.location.hash = paths.dictionary(); } else void add(); }}
        >
          <Icon name={added ? "check" : "add"} />
        </button>
      </div>
      {(info?.sentence || hit.line) && (
        <div className="wc-line">
          <div className="wc-sung" lang={language}>{info?.sentence || hit.line}</div>
          {info?.sentence_translation && <div className="wc-tr">{info.sentence_translation}</div>}
        </div>
      )}
      <div className="wc-status" role="status">{status}</div>
    </div>
  );
}
