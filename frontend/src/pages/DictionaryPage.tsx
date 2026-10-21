import { useCallback, useEffect, useMemo, useState } from "react";
import { Example } from "../components/Example";
import { LANGUAGES, languageName } from "../components/LanguageSelect";
import { useAsync } from "../hooks/useAsync";
import { useSnippets } from "../hooks/useSnippets";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { api, ApiError } from "../services/api";
import type { DictEntryDto, DictStatus } from "../services/api";
import { paths } from "../router";

const PAGE = 100;
const STATUSES: DictStatus[] = ["all", "due", "new", "suspended"];

export function headword(e: DictEntryDto): string {
  const w = e.lemma ?? e.surface;
  return e.article ? (e.article.endsWith("'") ? `${e.article}${w}` : `${e.article} ${w}`) : w;
}

export function DictionaryPage() {
  const [status, setStatus] = useState<DictStatus>("all");
  const [language, setLanguage] = useState("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const snippets = useSnippets();
  const summary = useAsync(() => api.reviewSummary(), []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setLimit(PAGE), [status, language, debounced]);

  const list = useAsync(
    () => api.dictionary({ status, language: language === "all" ? undefined : language, q: debounced || undefined, limit }),
    [status, language, debounced, limit],
  );
  const data = list.data;

  // translations arrive in the background: look again while some are still being looked up
  const pending = useMemo(() => (data?.items ?? []).some((e) => e.enrich_status === "pending"), [data]);
  const reload = list.reload;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(reload, 2500);
    return () => clearTimeout(t);
  }, [pending, data, reload]);

  // a language filter whose words are all gone must not leave an empty page
  useEffect(() => {
    if (data && language !== "all" && !data.languages.some((l) => l.code === language)) setLanguage("all");
  }, [data, language]);

  const fail = (e: unknown) => setNotice({ kind: "error", text: e instanceof ApiError ? e.message : en.errors.generic });
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      list.reload();
      summary.reload();
    } catch (e) {
      fail(e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reload, summary.reload]);

  const total = summary.data?.total ?? data?.total ?? 0;
  const available = (summary.data?.due ?? 0) + (summary.data?.new ?? 0);
  const everything = (data?.languages ?? []).reduce((n, l) => n + l.count, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{en.dictionary.title}</h1>
          <p className="count">{en.dictionary.count(total)}</p>
        </div>
        <a className="btn inverse large" href={paths.review()} aria-disabled={available === 0}>
          {available > 0 ? en.dictionary.reviewDue(available) : en.dictionary.review}
        </a>
      </div>
      {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      {snippets.blocked && <p className="notice error" role="status">{en.errors.playBlocked}</p>}

      {everything > 0 && (
        <>
          <div className="toolbar">
            <div className="chips" role="group" aria-label="Filter">
              {STATUSES.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {en.dictionary.filters[s]}
                  {s === "due" && summary.data ? <small>{summary.data.due}</small> : null}
                  {s === "new" && summary.data ? <small>{summary.data.new}</small> : null}
                </button>
              ))}
            </div>
            <div className="search-box">
              <input className="pill" type="search" {...noAutofill("dictionary-search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.dictionary.search} aria-label={en.dictionary.search} />
            </div>
          </div>
          {(data?.languages.length ?? 0) > 1 && (
            <div className="chips lang-chips" role="group" aria-label={en.dictionary.languageFilter}>
              <button type="button" className="chip" aria-pressed={language === "all"} onClick={() => setLanguage("all")}>{en.dictionary.allLanguages}</button>
              {data!.languages.map((l) => (
                <button key={l.code} type="button" className="chip" aria-pressed={language === l.code} onClick={() => setLanguage(l.code)}>
                  {LANGUAGES.some((x) => x.code === l.code) ? languageName(l.code) : l.code.toUpperCase()}<small>{l.count}</small>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {list.error && <p className="notice error">{list.error.message}</p>}
      {data && everything === 0 && status === "all" && !debounced && (
        <div className="empty">
          <p>{en.dictionary.empty}</p>
          <button type="button" className="btn secondary" onClick={() => void act(async () => { const r = await api.importWords(); setNotice({ kind: "ok", text: en.dictionary.imported(r.added) }); })}>{en.dictionary.importPast}</button>
        </div>
      )}
      {data && everything > 0 && data.items.length === 0 && <p className="empty">{en.dictionary.emptyFilter}</p>}

      <ul className="words">
        {(data?.items ?? []).map((e) => (
          <li key={e.id} className="word" data-suspended={e.suspended} data-open={open === e.id}>
            <button type="button" className="word-main" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="word-text">
                <span className="word-head" lang={e.language}>{headword(e)}</span>
                <span className="word-tr">
                  {e.translation ?? (e.enrich_status === "pending" ? en.dictionary.translating : e.enrich_status === "failed" ? en.dictionary.lookupFailed : en.dictionary.noTranslation)}
                </span>
              </span>
              <span className="word-meta">
                {e.suspended ? <span className="tag">{en.dictionary.filters.suspended}</span> : e.due_at === null ? <span className="tag">{en.dictionary.new}</span> : new Date(e.due_at).getTime() <= Date.now() ? <span className="tag due">{en.dictionary.due}</span> : null}
                <span className="muted">{en.dictionary.sentences(e.examples.length)}</span>
              </span>
            </button>
            {open === e.id && (
              <div className="word-detail">
                {e.lemma && <p className="hint">{en.dictionary.asSung(e.surface)}</p>}
                <ul className="examples">
                  {e.examples.map((ex) => <Example key={ex.id} ex={ex} word={e.surface} snippets={snippets} />)}
                </ul>
                {e.reps + e.lapses > 0 && <p className="hint">{en.dictionary.reps(e.reps, e.lapses)}</p>}
                <div className="song-actions">
                  <button type="button" className="btn quiet danger small" onClick={() => { if (window.confirm(en.dictionary.removeConfirm(headword(e)))) void act(() => api.deleteWord(e.id)); }}>{en.dictionary.remove}</button>
                  <button type="button" className="btn secondary small" onClick={() => void act(() => api.setSuspended(e.id, !e.suspended))}>{e.suspended ? en.dictionary.resume : en.dictionary.pause}</button>
                  {e.enrich_status === "failed" && <button type="button" className="btn secondary small" onClick={() => void act(() => api.refreshWord(e.id))}>{en.dictionary.lookupAgain}</button>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {data && data.items.length < data.total && (
        <p><button type="button" className="btn secondary" onClick={() => setLimit(limit + PAGE)}>{en.dictionary.more}</button></p>
      )}
    </>
  );
}
