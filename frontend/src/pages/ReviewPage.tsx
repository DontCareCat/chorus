import { useThumb } from "../hooks/useThumb";
import { useCallback, useEffect, useRef, useState } from "react";
import { Example } from "../components/Example";
import { useSnippets } from "../hooks/useSnippets";
import { en } from "../i18n/en";
import { formatInterval, nextIntervals } from "../lib/interval";
import { LANGUAGES, languageName } from "../components/LanguageSelect";
import { isOneOf, isString, readPref, usePref, writePref } from "../lib/prefs";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { DictStatus, RatedDto, Rating, ReviewNextDto, ReviewScope, ReviewSummaryDto } from "../services/api";
import { headword } from "./DictionaryPage";

const RATINGS: Rating[] = ["again", "hard", "good", "easy"];
const SIZES = [20, 40, 60] as const;
/** A card rated Again or Hard comes back after this many other cards (at once when no other card is left). */
const RETRY_GAP = 3;

interface Retry { id: number; word: string; language: string; interval: number; wait: number }
interface Session { target: number; shown: number[]; done: number; retry: Retry[] }

/** The filters the Dictionary page has on (remembered in cookies): the review uses only the words they show. */
const dictionaryScope = (): ReviewScope => ({
  status: readPref<DictStatus>("dict_status", "all", isOneOf("all", "due", "new", "suspended")),
  language: readPref("dict_language", "all", isString),
  q: readPref("dict_query", "", isString),
});

const describeScope = (scope: ReviewScope): string | null => {
  const parts = [
    scope.status && scope.status !== "all" ? en.dictionary.filters[scope.status] : null,
    scope.language && scope.language !== "all" ? (LANGUAGES.some((l) => l.code === scope.language) ? languageName(scope.language) : scope.language) : null,
    scope.q ? `“${scope.q}”` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

/**
 * Spaced review in sessions of 20, 40 or 60 words. A session always has its words, whether or not their time has come:
 * the ones that are due first, then new words, then the ones due soonest. A word rated Again or Hard comes back a few
 * cards later; the session lasts until every word has been rated Good or Easy.
 */
export function ReviewPage() {
  const sizeThumb = useThumb();
  const [scope, setScope] = useState<ReviewScope>(dictionaryScope);
  const scopeText = describeScope(scope);
  const [summary, setSummary] = useState<ReviewSummaryDto | null>(null);
  const [size, setSize] = usePref<number>("review_size", 20, isOneOf(...SIZES));
  const [session, setSession] = useState<Session | null>(null);
  const lastRating = useRef<Rating | null>(null);
  const [next, setNext] = useState<ReviewNextDto | null>(null);
  const [back, setBack] = useState<RatedDto | null>(null);
  const [rated, setRated] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const snippets = useSnippets();
  const busyRef = useRef(false);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : en.errors.generic);
  const loadSummary = useCallback(() => { api.reviewSummary(scope).then(setSummary, fail); }, [scope]);
  useEffect(loadSummary, [loadSummary]);

  const fetchNext = useCallback(async (shown: number[]) => {
    try {
      const r = await api.reviewNext(shown, scope);
      setNext(r);
      setBack(null);
      setError(null);
      return r;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [scope]);

  const start = useCallback(async () => {
    if (!summary) return;
    const r = await fetchNext([]);
    if (r?.card) {
      setSession({ target: Math.min(size, summary.available, summary.left_today ?? size), shown: [r.card.id], done: 0, retry: [] });
      setRated(0);
    }
  }, [summary, size, fetchNext]);

  const card = session ? next?.card ?? null : null;

  // the translation may still be on its way when the back of the card is shown
  useEffect(() => {
    if (!back || back.enrich_status !== "pending") return;
    const t = setTimeout(() => { api.getWord(back.id).then((w) => setBack((b) => (b && b.id === w.id ? { ...w, previous: b.previous } : b)), () => undefined); }, 2000);
    return () => clearTimeout(t);
  }, [back]);

  const rate = useCallback(async (rating: Rating) => {
    if (!card || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setBack(await api.rate(card.id, rating));
      lastRating.current = rating;
      setRated((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [card]);

  // Back: take the rating back (the card's schedule is restored) and show the front again
  const goBack = useCallback(async () => {
    if (!back || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api.undoRating(back.id, back.previous);
      setBack(null);
      setRated((n) => Math.max(0, n - 1));
      setError(null);
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [back]);

  const proceed = useCallback(async () => {
    if (!session || !back || busyRef.current) return;
    snippets.stop();
    const again = lastRating.current === "again" || lastRating.current === "hard";
    const retry: Retry[] = session.retry.map((c) => ({ ...c, wait: c.wait - 1 }));
    if (again) retry.push({ id: back.id, word: back.surface, language: back.language, interval: back.interval_seconds, wait: RETRY_GAP });
    const finished = session.done + (again ? 0 : 1);
    const ask = (c: Retry) => {
      setNext({ card: { id: c.id, word: c.word, language: c.language, intervals: nextIntervals(c.interval) }, summary: next?.summary ?? summary! });
      setBack(null);
      setError(null);
      setSession({ ...session, done: finished, retry: retry.filter((x) => x !== c) });
    };
    const fresh = session.shown.length < session.target;
    const due = retry.find((c) => c.wait <= 0);
    if (due || (!fresh && retry.length)) return ask(due ?? retry[0]!);
    if (fresh) {
      const r = await fetchNext(session.shown);
      if (r?.card) return setSession({ ...session, shown: [...session.shown, r.card.id], done: finished, retry });
      if (retry.length) return ask(retry[0]!); // no new word is left
    }
    setNext(null);
    setBack(null);
    setSession(null);
    loadSummary();
    setDone(true);
  }, [session, back, next, summary, fetchNext, loadSummary, snippets]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (card && !back) {
        const i = Number(e.key) - 1;
        if (i >= 0 && i < 4) { e.preventDefault(); void rate(RATINGS[i]!); }
      } else if (back && (e.key === "Backspace" || e.key === "ArrowLeft")) {
        e.preventDefault();
        void goBack();
      } else if (back && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
        if (tag === "BUTTON" && e.key !== "ArrowRight") return; // a focused button keeps its own key
        e.preventDefault();
        void proceed();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [card, back, rate, proceed, goBack]);

  if (error && !summary) return <p className="notice error">{error}</p>;
  if (!summary) return <p className="muted">…</p>;

  const top = (
    <div className="review-top">
      <a href={paths.dictionary()}>{en.dictionary.showInLibrary}</a>
      {session ? <span className="muted" aria-label="Progress">{en.dictionary.progress(Math.min(session.done + 1, session.target), session.target)}</span>
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
          {scopeText && (
            <p className="hint">
              {en.dictionary.scopeNote(scopeText)}{" "}
              <button type="button" className="btn quiet small" onClick={() => { for (const k of ["dict_status", "dict_language", "dict_query"]) writePref(k, k === "dict_status" ? "all" : k === "dict_language" ? "all" : ""); setScope({ status: "all", language: "all", q: "" }); }}>{en.dictionary.reviewAll}</button>
            </p>
          )}
          {summary.left_today === 0 ? (
            <div className="review-done"><h1>{en.dictionary.limitReached(summary.reviewed_today)}</h1><p>{en.dictionary.limitReachedHelp}</p></div>
          ) : summary.available === 0 ? (
            scopeText ? <div className="review-done"><h1>{en.dictionary.scopeEmpty}</h1><p>{en.dictionary.scopeEmptyHelp}</p></div>
              : <div className="review-done"><h1>{en.dictionary.nothingDue}</h1><p>{en.dictionary.nothingDueHelp}</p></div>
          ) : (
            <>
              {!done && <h1>{en.dictionary.sessionTitle}</h1>}
              <p className="hint">{en.dictionary.sessionHelp(summary.available)}</p>
              <div className="field">
                <span>{en.dictionary.sessionSize}</span>
                <div className="chips thumbs" role="group" aria-label={en.dictionary.sessionSize} ref={sizeThumb}>
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
          <div className="review-actions">
            <button type="button" className="btn secondary large" onClick={() => void goBack()} disabled={busy} title={en.dictionary.backHelp} aria-label={en.dictionary.backHelp}>{en.dictionary.back}</button>
            <button type="button" className="btn inverse large" onClick={() => void proceed()} disabled={busy} autoFocus>
              {session.shown.length >= session.target && !session.retry.length && lastRating.current !== "again" && lastRating.current !== "hard" ? en.dictionary.finish : en.dictionary.nextCard}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
