import { useConfirm } from "../components/Confirm";
import { DictionaryExchange } from "../components/DictionaryExchange";
import { WordEditor } from "../components/WordEditor";
import { useThumb } from "../hooks/useThumb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionMenu } from "../components/ActionMenu";
import { Icon } from "../components/Icon";
import { Toast, useToast } from "../components/Toast";
import { useLayout } from "../hooks/useLayout";
import { useLongPress } from "../hooks/useLongPress";
import { useNearEnd, usePagedList } from "../hooks/usePagedList";
import { useSelection } from "../hooks/useSelection";
import { Example } from "../components/Example";
import { LANGUAGES, languageName } from "../components/LanguageSelect";
import { useAsync } from "../hooks/useAsync";
import { useSnippets } from "../hooks/useSnippets";
import { en } from "../i18n/en";
import { isOneOf, isString, usePref } from "../lib/prefs";
import { noAutofill } from "../lib/noAutofill";
import { api, ApiError } from "../services/api";
import type { BulkAction, BulkTarget, DictEntryDto, DictListDto, DictStatus } from "../services/api";
import { paths } from "../router";

const STATUSES: DictStatus[] = ["all", "due", "new", "suspended"];

export function headword(e: DictEntryDto): string {
  const w = e.lemma ?? e.surface;
  return e.article ? (e.article.endsWith("'") ? `${e.article}${w}` : `${e.article} ${w}`) : w;
}

/** What stands where a word's translation goes: the translation, or why there is none. */
export function translationText(e: DictEntryDto): string {
  if (e.translation) return e.translation;
  if (e.enrich_status === "pending") return en.dictionary.translating;
  if (e.enrich_status === "failed") return en.dictionary.lookupFailed;
  if (e.translation_language && e.translation_language === e.language) return en.dictionary.sameLanguage;
  return en.dictionary.noTranslation;
}

export function DictionaryPage() {
  const confirm = useConfirm();
  const statusThumb = useThumb();
  const langThumb = useThumb();
  const [status, setStatus] = usePref<DictStatus>("dict_status", "all", isOneOf("all", "due", "new", "suspended"));
  const [language, setLanguage] = usePref("dict_language", "all", isString);
  const [query, setQuery] = usePref("dict_query", "", isString);
  const [debounced, setDebounced] = useState(query);
  const [open, setOpen] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ entry?: DictEntryDto } | null>(null);
  const [exchange, setExchange] = useState<"export" | "import" | null>(null);
  const [notice, setNotice] = useToast();
  const phone = useLayout() === "phone";
  const selection = useSelection();
  const [everyWord, setEveryWord] = useState(false); // "Select all": every word the filters show, minus the unticked ones
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set());
  const [barMenu, setBarMenu] = useState(false);
  const barMenuBtn = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const snippets = useSnippets();
  const summary = useAsync(() => api.reviewSummary(), []); // the counts on the chips: all words
  const scoped = useAsync(() => api.reviewSummary({ status, language, q: debounced }), [status, language, debounced]); // what a review would use

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // infinite scroll: one page at a time, the next one when the end of the list comes near
  const list = usePagedList<DictListDto, DictEntryDto>(
    (offset, limit) => api.dictionary({ status, language: language === "all" ? undefined : language, q: debounced || undefined, limit, offset }),
    [status, language, debounced],
  );
  const data = list.data;
  const endRef = useNearEnd(list.loadMore, list.hasMore && !list.loadingMore && !list.error);

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

  // select mode: what is ticked is what the filters show, so a new filter starts the ticks again
  const endSelection = selection.clear;
  const clearTicks = useCallback(() => { setEveryWord(false); setUnticked(new Set()); }, []);
  useEffect(() => { if (!selection.active) clearTicks(); }, [selection.active, clearTicks]);
  useEffect(() => { selection.keepOnly(new Set()); clearTicks(); }, [status, language, debounced, selection.keepOnly, clearTicks]);
  useEffect(() => {
    if (!selection.active) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".song-menu, .sheet, .dialog")) endSelection(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selection.active, endSelection]);
  const shownTotal = data?.total ?? 0;
  const pickedCount = everyWord ? Math.max(0, shownTotal - unticked.size) : selection.picked.size;
  const isPicked = (id: number) => (everyWord ? !unticked.has(id) : selection.has(id));
  const togglePick = (id: number) => {
    if (!everyWord) return selection.toggle(id);
    setUnticked((u) => { const n = new Set(u); if (!n.delete(id)) n.add(id); return n; });
  };
  const toggleAll = () => {
    if (pickedCount > 0 && pickedCount === shownTotal) { clearTicks(); selection.selectAll([]); }
    else { selection.selectAll([]); setUnticked(new Set()); setEveryWord(true); }
  };
  const target = (): BulkTarget =>
    everyWord ? { filter: { status, language: language === "all" ? undefined : language, q: debounced || undefined }, exclude: [...unticked] } : { ids: [...selection.picked] };
  const bulk = async (action: BulkAction) => {
    const n = pickedCount;
    if (n === 0) return;
    if (action === "delete" && !(await confirm({ title: en.dictionary.removeMany(n), body: en.dictionary.removeManyBody, action: en.dictionary.removeAction }))) return;
    if (action === "reset" && !(await confirm({ title: en.dictionary.resetMany(n), body: en.dictionary.resetManyBody, action: en.dictionary.resetAction }))) return;
    setBusy(true);
    try {
      const r = await api.bulkWords(action, target());
      endSelection();
      setNotice({ kind: "ok", text: en.dictionary.bulkDone[action](r.changed) });
      if (action === "delete") setOpen(null);
      list.reload();
      summary.reload();
      scoped.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // a long press on a phone starts select mode with that word ticked; afterwards a tap ticks or unticks
  const pressed = useRef<number | null>(null);
  const press = useLongPress({
    onLongPress: () => {
      const id = pressed.current;
      if (id === null) return;
      if (!selection.active) setOpen(null);
      if (everyWord) setUnticked((u) => { const n = new Set(u); n.delete(id); return n; });
      else selection.add(id);
    },
  });
  const rowClick = (id: number) => {
    if (press.consumeClick()) return;
    if (selection.active) togglePick(id);
    else setOpen(open === id ? null : id);
  };
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      list.reload();
      summary.reload();
      scoped.reload();
    } catch (e) {
      fail(e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reload, summary.reload, scoped.reload]);

  /** A word with a meaning the user wrote is only looked up again after they agree to lose it. */
  const lookupAgain = async (e: DictEntryDto) => {
    const replace = e.meaning_edited;
    if (replace && !(await confirm({ title: en.dictionary.replaceMeaningTitle(headword(e)), body: en.dictionary.replaceMeaningBody, action: en.dictionary.replaceMeaningAction }))) return;
    await act(() => api.refreshWord(e.id, replace));
  };

  const total = summary.data?.total ?? data?.total ?? 0;
  const available = (scoped.data?.due ?? 0) + (scoped.data?.new ?? 0);
  const everything = Math.max(summary.data?.total ?? 0, (data?.languages ?? []).reduce((n, l) => n + l.count, 0)); // the whole dictionary, not what the filters leave

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{en.dictionary.title}</h1>
          <p className="count">{en.dictionary.count(total)}</p>
        </div>
        <div className="dict-actions">
          <button type="button" className="btn quiet bordered small" onClick={() => setEditor({})}>{en.dictionary.addWord}</button>
          {!phone && <button type="button" className="btn quiet bordered small" onClick={() => { setOpen(null); selection.selectAll([]); }} disabled={shownTotal === 0 || selection.active}>{en.dictionary.select}</button>}
          <button type="button" className="btn quiet bordered small" onClick={() => setExchange("export")} disabled={everything === 0}>{en.dictionary.exchange.export}</button>
          <button type="button" className="btn quiet bordered small" onClick={() => setExchange("import")}>{en.dictionary.exchange.import}</button>
        </div>
        <a className="btn inverse large" href={paths.review()} aria-disabled={(scoped.data?.available ?? 0) === 0}>
          {available > 0 ? en.dictionary.reviewDue(available) : en.dictionary.review}
        </a>
      </div>
      {editor && <WordEditor entry={editor.entry} defaultLanguage={language !== "all" ? language : data?.languages[0]?.code ?? "de"} onClose={() => setEditor(null)} onSaved={() => { list.reload(); summary.reload(); scoped.reload(); }} />}
      {exchange && <DictionaryExchange mode={exchange} scope={{ status, language: language === "all" ? undefined : language, q: debounced || undefined }} shown={total} defaultLanguage={language !== "all" ? language : data?.languages[0]?.code ?? "de"} onClose={() => setExchange(null)} onImported={() => { list.reload(); summary.reload(); }} />}
      <div className="toast-lane"><Toast toast={notice} onDismiss={() => setNotice(null)} /></div>
      {snippets.blocked && <p className="notice error" role="status">{en.errors.playBlocked}</p>}

      {everything > 0 && (
        <>
          <div className="toolbar">
            <div className="chips thumbs" role="group" aria-label="Filter" ref={statusThumb}>
              {STATUSES.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {en.dictionary.filters[s]}
                  {data ? <small key={data.status_counts[s] ?? 0}>{data.status_counts[s] ?? 0}</small> : null}
                </button>
              ))}
            </div>
            <div className="search-box">
              <input className="pill" type="search" {...noAutofill("dictionary-search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.dictionary.search} aria-label={en.dictionary.search} />
            </div>
          </div>
          {(data?.languages.length ?? 0) > 0 && (
            <div className="chips lang-chips thumbs" role="group" aria-label={en.dictionary.languageFilter} ref={langThumb}>
              <button type="button" className="chip" aria-pressed={language === "all"} onClick={() => setLanguage("all")}>{en.dictionary.allLanguages}</button>
              {data!.languages.map((l) => (
                <button key={l.code} type="button" className="chip" aria-pressed={language === l.code} onClick={() => setLanguage(l.code)}>
                  {LANGUAGES.some((x) => x.code === l.code) ? languageName(l.code) : l.code.toUpperCase()}<small key={l.count}>{l.count}</small>
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

      {selection.active && (
        <div className="select-bar" role="toolbar" aria-label={en.dictionary.selectedCount(pickedCount)}>
          <input
            type="checkbox" className="pick select-all" aria-label={en.dictionary.selectAll(shownTotal)} title={en.dictionary.selectAll(shownTotal)}
            checked={pickedCount > 0 && pickedCount === shownTotal} ref={(el) => { if (el) el.indeterminate = pickedCount > 0 && pickedCount < shownTotal; }}
            onChange={toggleAll} disabled={shownTotal === 0}
          />
          <strong>{en.dictionary.selectedCount(pickedCount)}</strong>
          <button type="button" className="icon-btn" ref={barMenuBtn} onClick={() => setBarMenu((v) => !v)} aria-haspopup="menu" aria-expanded={barMenu} aria-label={en.dictionary.moreActions} title={en.dictionary.moreActions} disabled={busy || pickedCount === 0}><Icon name="more" /></button>
          <button type="button" className="icon-btn danger" onClick={() => void bulk("delete")} disabled={busy || pickedCount === 0} aria-label={en.dictionary.removeSelected} title={en.dictionary.removeSelected}><Icon name="trash" /></button>
          <button type="button" className="icon-btn" onClick={endSelection} aria-label={en.dictionary.cancelSelection} title={en.dictionary.cancelSelection}><Icon name="close" /></button>
        </div>
      )}
      {barMenu && (
        <ActionMenu
          label={en.dictionary.selectedCount(pickedCount)} phone={phone} anchor={barMenuBtn.current} onClose={() => setBarMenu(false)}
          items={[{ id: "pause", icon: "pause", label: en.dictionary.bulk.pause }, { id: "resume", icon: "play", label: en.dictionary.bulk.resume }, { id: "reset", icon: "undo", label: en.dictionary.bulk.reset }]}
          onPick={(id) => void bulk(id as BulkAction)}
        />
      )}

      <ul className="words" key={`${status}|${language}`} data-selecting={selection.active}>
        {(data?.items ?? []).map((e) => (
          <li key={e.id} className="word" data-suspended={e.suspended} data-open={open === e.id} data-picked={selection.active ? isPicked(e.id) : undefined}>
            {selection.active && <input type="checkbox" className="pick" checked={isPicked(e.id)} onChange={() => togglePick(e.id)} aria-label={en.dictionary.pick(headword(e))} />}
            <button
              type="button" className="word-main" aria-expanded={selection.active ? undefined : open === e.id} aria-pressed={selection.active ? isPicked(e.id) : undefined}
              onClick={() => rowClick(e.id)}
              {...press.handlers} onPointerDown={(ev) => { pressed.current = e.id; press.handlers.onPointerDown(ev); }}
            >
              <span className="word-text">
                <span className="word-head" lang={e.language}>{headword(e)}</span>
                <span className="word-tr">
                  {translationText(e)}
                </span>
              </span>
              <span className="word-meta">
                {e.suspended ? <span className="tag">{en.dictionary.filters.suspended}</span> : e.due_at === null ? <span className="tag">{en.dictionary.new}</span> : new Date(e.due_at).getTime() <= Date.now() ? <span className="tag due">{en.dictionary.due}</span> : null}
                <span className="muted">{en.dictionary.sentences(e.examples.length)}</span>
              </span>
            </button>
            {open === e.id && !selection.active && (
              <div className="expand"><div className="word-detail">
                {(e.lemma || e.pos) && <p className="hint">{[e.pos ? en.wordCard.pos[e.pos] ?? e.pos : null, e.lemma ? en.dictionary.asSung(e.surface) : null].filter(Boolean).join(" · ")}</p>}
                <ul className="examples">
                  {e.examples.map((ex) => <Example key={ex.id} ex={ex} word={e.surface} snippets={snippets} />)}
                </ul>
                {e.reps + e.lapses > 0 && <p className="hint">{en.dictionary.reps(e.reps, e.lapses)}</p>}
                <div className="song-actions">
                  <button type="button" className="btn quiet bordered danger small" onClick={() => { void confirm({ title: en.dictionary.removeConfirm(headword(e)), body: en.dictionary.removeConfirmBody, action: en.dictionary.removeAction }).then((ok) => { if (ok) void act(() => api.deleteWord(e.id)); }); }}>{en.dictionary.remove}</button>
                  <button type="button" className="btn secondary small" onClick={() => void act(() => api.setSuspended(e.id, !e.suspended))}>{e.suspended ? en.dictionary.resume : en.dictionary.pause}</button>
                  <button type="button" className="btn secondary small" onClick={() => void lookupAgain(e)}>{en.dictionary.lookupAgain}</button>
                  <button type="button" className="btn secondary small" onClick={() => setEditor({ entry: e })}>{en.dictionary.edit}</button>
                </div>
              </div></div>
            )}
          </li>
        ))}
      </ul>
      {list.hasMore && (
        <p className="list-end" ref={endRef} role="status">
          {list.loadingMore || typeof IntersectionObserver !== "undefined" ? <span className="muted">{en.dictionary.loadingMore}</span> : <button type="button" className="btn secondary" onClick={list.loadMore}>{en.dictionary.more}</button>}
        </p>
      )}
    </>
  );
}
