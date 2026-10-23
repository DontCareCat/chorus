import { Select } from "./Select";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAsync } from "../hooks/useAsync";
import { noAutofill } from "../lib/noAutofill";
import { en } from "../i18n/en";
import { api, ApiError } from "../services/api";
import type { FsListingDto, ScanDto } from "../services/api";

interface Props {
  /** "import": pick songs and folders and import them. "folder": pick one folder (Settings). */
  mode: "import" | "folder";
  /** Where to start (an empty path = the home folder). */
  start?: string;
  recursiveDefault?: boolean;
  copyDefault?: boolean;
  onClose: () => void;
  onImported?: (result: ScanDto) => void;
  onPickFolder?: (path: string) => void;
}

const sep = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + sep(dir) + name);
const size = (n: number | null) => (n === null ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/** Breadcrumb pieces of a path: [{label, path}], for both / and \ paths. */
export function crumbs(path: string): { label: string; path: string }[] {
  const win = /^[A-Za-z]:/.test(path);
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const out: { label: string; path: string }[] = [];
  let acc = win ? "" : "/";
  if (!win) out.push({ label: "/", path: "/" });
  parts.forEach((p, i) => {
    acc = win ? (i === 0 ? `${p}\\` : join(acc, p)) : join(acc, p);
    out.push({ label: p, path: acc });
  });
  return out;
}

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
);
const NoteIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>
);

/**
 * A window over the page (full screen on phones) for picking music on the computer that runs Chorus: type or paste a
 * path, walk through folders, tick several songs and folders, import them in one go. Only names and sizes are listed.
 */
export function FolderBrowser({ mode, start = "", recursiveDefault = true, copyDefault = false, onClose, onImported, onPickFolder }: Props) {
  const [path, setPath] = useState(start);
  const [typed, setTyped] = useState(start);
  const [edited, setEdited] = useState(false); // the person is typing: a listing that arrives meanwhile must not overwrite it
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recursive, setRecursive] = useState(recursiveDefault);
  const [copy, setCopy] = useState(copyDefault);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const listing = useAsync<FsListingDto>(() => api.listFolder(path || undefined, hidden), [path, hidden]);
  useEffect(() => { if (listing.data && !edited) setTyped(listing.data.path); }, [listing.data, edited]);
  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = listing.data;
  const here = data?.path ?? path;
  const go = useCallback((p: string) => { setPath(p); setEdited(false); setError(null); }, []);
  const toggle = (full: string) => setSelected((s) => { const n = new Set(s); if (n.has(full)) n.delete(full); else n.add(full); return n; });
  const entries = data?.entries ?? [];
  const selectable = useMemo(() => (mode === "folder" ? [] : entries.map((e) => join(here, e.name))), [entries, here, mode]);
  const files = [...selected].filter((p) => entries.every((e) => join(here, e.name) !== p || e.kind === "audio")).length;
  const folders = selected.size - files;

  const submitPath = (e: React.FormEvent) => { e.preventDefault(); if (typed.trim()) go(typed.trim()); };
  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.importMany({ paths: [...selected], recursive, copyFiles: copy, include: include.trim(), exclude: exclude.trim() });
      onImported?.(result);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
      setBusy(false);
    }
  };

  const loadError = listing.error ? (listing.error.status === 403 && listing.error.code === "path_access_denied" ? en.browser.denied : listing.error.message) : null;

  // a portal: the window belongs to the page, not to whatever form opened it (nested forms are not allowed in HTML)
  return createPortal(
    <div className="dialog-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="browser-title" ref={dialog} tabIndex={-1}>
        <header className="dialog-head">
          <h2 id="browser-title">{mode === "folder" ? en.browser.pickTitle : en.browser.title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={en.browser.close} title={en.browser.close}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <form autoComplete="off" className="path-bar" onSubmit={submitPath}>
          <button type="button" className="btn secondary small" onClick={() => data?.parent && go(data.parent)} disabled={!data?.parent} aria-label={en.browser.up} title={en.browser.up}>↑</button>
          <input type="text" value={typed} onChange={(e) => { setTyped(e.target.value); setEdited(true); }} aria-label={en.browser.path} {...noAutofill("folder-path")} />
          <Select ariaLabel={en.browser.places} value="" placeholder={en.browser.places} sheetOnPhone={false} onChange={(v: string) => go(v)} options={(data?.roots ?? []).map((r) => ({ value: r.path, label: r.name }))} />
        </form>
        <nav className="crumbs" aria-label={en.browser.way}>
          {crumbs(here).map((c, i, all) => (
            <button key={c.path} type="button" onClick={() => go(c.path)} aria-current={i === all.length - 1 ? "page" : undefined}>{c.label}</button>
          ))}
        </nav>

        <div className="dialog-body">
          {loadError && <p className="notice error" role="alert">{loadError}</p>}
          {listing.loading && !data && <p className="muted">…</p>}
          {data && entries.length === 0 && !loadError && <p className="muted">{en.browser.empty}</p>}
          <ul className="fs-list" aria-label={en.browser.title}>
            {entries.map((e) => {
              const full = join(here, e.name);
              return (
                <li key={e.name} data-kind={e.kind}>
                  {mode === "import" && (
                    <label className="fs-check">
                      <input type="checkbox" checked={selected.has(full)} onChange={() => toggle(full)} aria-label={en.browser.select(e.name)} />
                    </label>
                  )}
                  {e.kind === "dir" ? (
                    <button type="button" className="fs-name" onClick={() => go(full)} aria-label={en.browser.open(e.name)}><FolderIcon /><span>{e.name}</span>{e.link && <small>{en.browser.link}</small>}</button>
                  ) : (
                    <label className="fs-name"><NoteIcon /><span>{e.name}</span><small>{size(e.size)}</small></label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="dialog-foot">
          <div className="fs-tools">
            {mode === "import" && (
              <>
                <button type="button" className="btn quiet small" onClick={() => setSelected(new Set(selectable))}>{en.browser.selectAll}</button>
                <button type="button" className="btn quiet small" onClick={() => setSelected(new Set())}>{en.browser.selectNone}</button>
              </>
            )}
            <label className="check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /><span>{en.browser.hidden}</span></label>
          </div>
          {mode === "import" && (
            <>
              <div className="fs-options">
                <label className="check"><input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /><span>{en.browser.subfolders}</span></label>
                <label className="check"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /><span>{en.browser.copy}</span></label>
              </div>
              <details className="fs-filter">
                <summary>{en.browser.filter}</summary>
                <div className="inline">
                  <label className="field"><span>{en.browser.include}</span><input type="text" value={include} onChange={(e) => setInclude(e.target.value)} {...noAutofill("include-pattern")} placeholder="\.(mp3|flac)$" /></label>
                  <label className="field"><span>{en.browser.exclude}</span><input type="text" value={exclude} onChange={(e) => setExclude(e.target.value)} {...noAutofill("exclude-pattern")} placeholder="live|remix" /></label>
                </div>
                <small className="hint">{en.browser.filterHelp}</small>
              </details>
            </>
          )}
          {error && <p className="notice error" role="alert">{error}</p>}
          <div className="fs-actions">
            <span className="muted" aria-live="polite">{mode === "import" ? en.browser.selected(files, folders) : here}</span>
            <button type="button" className="btn quiet" onClick={onClose}>{en.browser.cancel}</button>
            {mode === "import" ? (
              <button type="button" className="btn" onClick={() => void doImport()} disabled={busy || selected.size === 0}>{busy ? en.browser.importing : en.browser.importSelected}</button>
            ) : (
              <button type="button" className="btn" onClick={() => { onPickFolder?.(here); onClose(); }} disabled={!data}>{en.browser.useFolder}</button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
