import { useEffect, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { api, ApiError } from "../services/api";
import type { SettingsDto } from "../services/api";

export function SettingsPage() {
  const loaded = useAsync(() => api.settings(), []);
  const [form, setForm] = useState<SettingsDto | null>(null);
  const [folders, setFolders] = useState("");
  const [forever, setForever] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (loaded.data) {
      setForm(loaded.data);
      setFolders(loaded.data.library_dirs.join("\n"));
      setForever(loaded.data.lyrics_cache_ttl_days === 0);
    }
  }, [loaded.data]);

  if (loaded.error) return <p className="notice error">{loaded.error.message}</p>;
  if (!form) return <p className="muted">…</p>;
  const set = <K extends keyof SettingsDto>(k: K, v: SettingsDto[K]) => setForm({ ...form, [k]: v });

  const save = async () => {
    try {
      const next = { ...form, lyrics_cache_ttl_days: forever ? 0 : Math.max(1, form.lyrics_cache_ttl_days || 30), library_dirs: folders.split("\n").map((l) => l.trim()).filter(Boolean) };
      setForm(await api.saveSettings(next));
      setNotice({ kind: "ok", text: en.settings.saved });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof ApiError ? e.message : en.errors.generic });
    }
  };
  const clear = async () => {
    const r = await api.clearCache();
    setNotice({ kind: "ok", text: en.settings.cacheCleared(r.deleted) });
  };

  return (
    <>
      <div className="page-head"><h1>{en.settings.title}</h1></div>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="check">
          <input type="checkbox" checked={form.allow_unsynchronized_lyrics} onChange={(e) => set("allow_unsynchronized_lyrics", e.target.checked)} />
          <span><strong>{en.settings.allowUnsynced}</strong><small>{en.settings.allowUnsyncedHelp}</small></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.auto_fetch_lyrics} onChange={(e) => set("auto_fetch_lyrics", e.target.checked)} />
          <span><strong>{en.settings.autoFetch}</strong></span>
        </label>
        <label className="field">
          <span>{en.settings.defaultLanguage}</span>
          <input type="text" value={form.default_language} maxLength={16} onChange={(e) => set("default_language", e.target.value)} />
          <small>{en.settings.defaultLanguageHelp}</small>
        </label>
        <div className="field">
          <span>{en.settings.cacheDays}</span>
          <input type="number" min={1} disabled={forever} value={forever ? "" : form.lyrics_cache_ttl_days} onChange={(e) => set("lyrics_cache_ttl_days", Number(e.target.value))} aria-label={en.settings.cacheDays} />
          <label className="check" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={forever}
              onChange={(e) => {
                setForever(e.target.checked);
                if (!e.target.checked && form.lyrics_cache_ttl_days < 1) set("lyrics_cache_ttl_days", 30); // 0 means "forever", not a valid number of days
              }}
            />
            <span>{en.settings.cacheForever}</span>
          </label>
        </div>
        <label className="field">
          <span>{en.settings.folders}</span>
          <textarea value={folders} onChange={(e) => setFolders(e.target.value)} spellCheck={false} />
          <small>{en.settings.foldersHelp}</small>
        </label>
        <div className="inline" style={{ marginTop: "1.5rem" }}>
          <button type="submit" className="btn">{en.settings.save}</button>
          <button type="button" className="btn quiet" onClick={() => void clear()}>{en.settings.clearCache}</button>
        </div>
        {notice && <p className={`notice ${notice.kind}`} role="status" style={{ marginTop: "1rem" }}>{notice.text}</p>}
      </form>
    </>
  );
}
