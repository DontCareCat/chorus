import { useCallback, useEffect, useRef, useState } from "react";
import { Example } from "../components/Example";
import { useSnippets } from "../hooks/useSnippets";
import { en } from "../i18n/en";
import { formatInterval } from "../lib/interval";
import { isOneOf, usePref } from "../lib/prefs";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { DictEntryDto, Rating, ReviewNextDto, ReviewSummaryDto } from "../services/api";
import { headword } from "./DictionaryPage";

const RATINGS: Rating[] = ["again", "hard", "good", "easy"];
const SIZES = [20, 40, 60] as const;

/**
 * Spaced review in sessions of 20, 40 or 60 words. A session always has its words, whether or not their time has come:
 * the ones that are due first, then new words, then the ones due soonest. Each word is shown once per session.
 */
export function ReviewPage() {
  const [summary, setSummary] = useState<ReviewSummaryDto | null>(null);
  const [size, setSize] = usePref<number>("review_size", 20, isOneOf(...SIZES));
  const [session, setSession] = useState<{ target: number; shown: number[] } | null>(null);
  const [next, setNext] = useState<ReviewNextDto | null>(null);
  const [back, setBack] = useState<DictEntryDto | null>(null);
  const [rated, setRated] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const snippets = useSnippets();
  const busyRef = useRef(false);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : en.errors.generic);
  const loadSummary = useCallback(() => { api.reviewSummary().then(setSummary, fail); }, []);
  useEffect(loadSummary, [loadSummary]);

  const fetchNext = useCallback(async (shown: number[]) => {
    try {
      const r = await api.reviewNext(shown);
      setNext(r);
      setBack(null);
      setError(null);
      return r;
    } catch (e) {
      fail(e);
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!summary) return;
    const r = await fetchNext([]);
    if (r?.card) {
      setSession({ target: Math.min(size, summary.available, summary.left_today ?? size), shown: [r.card.id] });
      setRated(0);
    }
  }, [summary, size, fetchNext]);

  const card = session ? next?.card ?? null : null;

  // the translation may still be on its way when the back of the card is shown
  useEffect(() => {
    if (!back || back.enrich_status !== "pending") return;
    const t = setTimeout(() => { api.getWord(back.id).then(setBack, () => undefined); }, 2000);
    return () => clearTimeout(t);
  }, [back]);

  const rate = useCallback(async (rating: Rating) => {
    if (!card || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setBack(await api.rate(card.id, rating));
      setRated((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [card]);

  const proceed = useCallback(async () => {
    if (!session || busyRef.current) return;
    if (session.shown.length >= session.target) { // the session is complete
      setNext(null);
      setBack(null);
      setSession(null);
      loadSummary();
      setDone(true);
      return;
    }
    const r = await fetchNext(session.shown);
    if (r?.card) setSession({ ...session, shown: [...session.shown, r.card.id] });
    else { setSession(null); setDone(true); loadSummary(); }
  }, [session, fetchNext, loadSummary]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (card && !back) {
        const i = Number(e.key) - 1;
        if (i >= 0 && i < 4) { e.preventDefault(); void rate(RATINGS[i]!); }
      } else if (back && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
        if (tag === "BUTTON" && e.key !== "ArrowRight") return; // a focused button keeps its own key
        e.preventDefault();
        void proceed();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [card, back, rate, proceed]);

  if (error && !summary) return <p className="notice error">{error}</p>;
  if (!summary) return <p className="muted">…</p>;

  const top = (
    <div className="review-top">
      <a href={paths.dictionary()}>{en.dictionary.showInLibrary}</a>
      {session ? <span className="muted" aria-label="Progress">{en.dictionary.progress(Math.min(session.shown.length, session.target), session.target)}</span>
        : <span className="muted">{en.dictionary.reviewLeft(summary.due, summary.new)}{summary.left_today !== null ? ` · ${en.dictionary.leftToday(summary.left_today)}` : ""}</span>}
    </div>
  );

  return (
    <section className="review" aria-live="polite">
      {top}
      {error && <p className="notice error" role="alert">{error}</p>}

      {!session && (
        <div className="review-start">
          {done && (
            <div className="review-done">
              <h1>{en.dictionary.sessionDone}</h1>
              <p>{en.dictionary.sessionDoneHelp(rated)}</p>
            </div>
          )}
          {summary.left_today === 0 ? (
            <div className="review-done"><h1>{en.dictionary.limitReached(summary.reviewed_today)}</h1><p>{en.dictionary.limitReachedHelp}</p></div>
          ) : summary.available === 0 ? (
            <div className="review-done"><h1>{en.dictionary.nothingDue}</h1><p>{en.dictionary.nothingDueHelp}</p></div>
          ) : (
            <>
              {!done && <h1>{en.dictionary.sessionTitle}</h1>}
              <p className="hint">{en.dictionary.sessionHelp(summary.available)}</p>
              <div className="field">
                <span>{en.dictionary.sessionSize}</span>
                <div className="chips" role="group" aria-label={en.dictionary.sessionSize}>
                  {SIZES.map((n) => (
                    <button key={n} type="button" className="chip" aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>
                  ))}
                </div>
              </div>
              <button type="button" className="btn inverse large" onClick={() => { setDone(false); void start(); }}>{done ? en.dictionary.again2 : en.dictionary.start}</button>
            </>
          )}
        </div>
      )}

      {session && card && !back && (
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

      {session && back && (
        <div className="review-card review-back">
          <p className="review-word" lang={back.language}>{headword(back)}</p>
          {back.lemma && <p className="hint">{en.dictionary.asSung(back.surface)}</p>}
          <p className="review-tr">{back.translation ?? (back.enrich_status === "pending" ? en.dictionary.translating : back.enrich_status === "failed" ? en.dictionary.lookupFailed : en.dictionary.noTranslation)}</p>
          <ul className="examples">
            {back.examples.map((ex) => <Example key={ex.id} ex={ex} word={back.surface} snippets={snippets} />)}
          </ul>
          <button type="button" className="btn inverse large" onClick={() => void proceed()} autoFocus>
            {session.shown.length >= session.target ? en.dictionary.finish : en.dictionary.nextCard}
          </button>
        </div>
      )}
    </section>
  );
}
