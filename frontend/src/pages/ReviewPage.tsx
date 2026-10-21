import { useCallback, useEffect, useRef, useState } from "react";
import { Example } from "../components/Example";
import { useSnippets } from "../hooks/useSnippets";
import { en } from "../i18n/en";
import { formatInterval, formatWait } from "../lib/interval";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { DictEntryDto, Rating, ReviewNextDto } from "../services/api";
import { headword } from "./DictionaryPage";

const RATINGS: Rating[] = ["again", "hard", "good", "easy"];

/** Spaced review: the word alone, then how hard it was; then the article, translation and the song lines (each playable). */
export function ReviewPage() {
  const [next, setNext] = useState<ReviewNextDto | null>(null);
  const [back, setBack] = useState<DictEntryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const snippets = useSnippets();
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setNext(await api.reviewNext());
      setBack(null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // nothing due right now: check again when the next card is
  useEffect(() => {
    if (!next || next.card || !next.next_due_at) return;
    const wait = Math.min(60000, Math.max(1000, new Date(next.next_due_at).getTime() - Date.now() + 500));
    const t = setTimeout(() => void load(), wait);
    return () => clearTimeout(t);
  }, [next, load]);

  // the translation may still be on its way when the back of the card is shown
  useEffect(() => {
    if (!back || back.enrich_status !== "pending") return;
    const t = setTimeout(() => { api.getWord(back.id).then(setBack, () => undefined); }, 2000);
    return () => clearTimeout(t);
  }, [back]);

  const card = next?.card ?? null;
  const rate = useCallback(async (rating: Rating) => {
    if (!card || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setBack(await api.rate(card.id, rating));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [card]);

  const proceed = useCallback(() => { if (!busyRef.current) void load(); }, [load]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (card && !back) {
        const i = Number(e.key) - 1;
        if (i >= 0 && i < 4) { e.preventDefault(); void rate(RATINGS[i]!); }
      } else if (back && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
        if ((e.target as HTMLElement | null)?.tagName === "BUTTON" && e.key !== "ArrowRight") return; // a focused button keeps its own key
        e.preventDefault();
        proceed();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [card, back, rate, proceed]);

  if (error && !next) return <p className="notice error">{error}</p>;
  if (!next) return <p className="muted">…</p>;

  const left = next.summary;
  return (
    <section className="review" aria-live="polite">
      <div className="review-top">
        <a href={paths.dictionary()}>{en.dictionary.showInLibrary}</a>
        <span className="muted">{en.dictionary.reviewLeft(left.due, left.new)}</span>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}

      {!card && !back && (
        <div className="review-done">
          <h1>{en.dictionary.nothingDue}</h1>
          {next.next_due_at ? <p>{en.dictionary.when(formatWait(new Date(next.next_due_at).getTime() - Date.now()))}</p> : <p>{en.dictionary.nothingDueHelp}</p>}
        </div>
      )}

      {card && !back && (
        <div className="review-card">
          <p className="review-word" lang={card.language}>{card.word}</p>
          <p className="hint">{en.dictionary.howHard}</p>
          <div className="rate" role="group" aria-label={en.dictionary.howHard}>
            {RATINGS.map((r, i) => (
              <button key={r} type="button" className="rate-btn" data-rating={r} disabled={busy} onClick={() => void rate(r)}>
                <strong>{en.dictionary[r]}</strong>
                <small>{formatInterval(card.intervals[r])}</small>
                <kbd aria-hidden="true">{i + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
      )}

      {back && (
        <div className="review-card review-back">
          <p className="review-word" lang={back.language}>{headword(back)}</p>
          {back.lemma && <p className="hint">{en.dictionary.asSung(back.surface)}</p>}
          <p className="review-tr">{back.translation ?? (back.enrich_status === "pending" ? en.dictionary.translating : back.enrich_status === "failed" ? en.dictionary.lookupFailed : en.dictionary.noTranslation)}</p>
          <ul className="examples">
            {back.examples.map((ex) => <Example key={ex.id} ex={ex} word={back.surface} snippets={snippets} />)}
          </ul>
          <button type="button" className="btn inverse large" onClick={proceed} autoFocus>{en.dictionary.nextCard}</button>
        </div>
      )}
    </section>
  );
}
