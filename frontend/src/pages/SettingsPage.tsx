import { useEffect, useState } from "react";
import { LanguageSelect } from "../components/LanguageSelect";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { en } from "../i18n/en";
import { api, ApiError } from "../services/api";
import type { SettingsDto, UserDto } from "../services/api";

type Notice = { kind: "ok" | "error"; text: string } | null;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);

export function SettingsPage() {
  const { user } = useAuth();
  const loaded = useAsync(() => api.settings(), []);
  const [form, setForm] = useState<SettingsDto | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [forever, setForever] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (loaded.data) {
      setForm(loaded.data);
      setFolders(loaded.data.library_dirs);
      setForever(loaded.data.lyrics_cache_ttl_days === 0);
    }
  }, [loaded.data]);

  if (loaded.error) return <p className="notice error">{loaded.error.message}</p>;
  if (!form) return <p className="muted">…</p>;
  const set = <K extends keyof SettingsDto>(k: K, v: SettingsDto[K]) => setForm({ ...form, [k]: v });
  const addFolder = () => {
    const f = newFolder.trim();
    if (f && !folders.includes(f)) setFolders([...folders, f]);
    setNewFolder("");
  };

  const save = async () => {
    try {
      const pending = newFolder.trim();
      const dirs = pending && !folders.includes(pending) ? [...folders, pending] : folders;
      const next = { ...form, lyrics_cache_ttl_days: forever ? 0 : Math.max(1, form.lyrics_cache_ttl_days || 30), library_dirs: dirs };
      const saved = await api.saveSettings(next);
      setForm(saved);
      setFolders(saved.library_dirs);
      setNewFolder("");
      setNotice({ kind: "ok", text: en.settings.saved });
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  const clear = async () => {
    if (!window.confirm(en.settings.clearConfirm)) return;
    const r = await api.clearCache();
    setNotice({ kind: "ok", text: en.settings.cacheCleared(r.deleted) });
  };

  return (
    <>
      <div className="page-head"><h1>{en.settings.title}</h1></div>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <section className="panel">
          <h2>{en.settings.lyricsPanel}</h2>
          <label className="check">
            <input type="checkbox" checked={form.allow_unsynchronized_lyrics} onChange={(e) => set("allow_unsynchronized_lyrics", e.target.checked)} />
            <span><strong>{en.settings.allowUnsynced}</strong><small>{en.settings.allowUnsyncedHelp}</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.auto_fetch_lyrics} onChange={(e) => set("auto_fetch_lyrics", e.target.checked)} />
            <span><strong>{en.settings.autoFetch}</strong></span>
          </label>
          <div className="field">
            <span>{en.settings.cacheDays}</span>
            <input type="number" min={1} disabled={forever} value={forever ? "" : form.lyrics_cache_ttl_days} onChange={(e) => set("lyrics_cache_ttl_days", Number(e.target.value))} aria-label={en.settings.cacheDays} style={{ maxWidth: "12rem" }} />
            <label className="check" style={{ marginTop: 12, marginBottom: 0 }}>
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
          <button type="button" className="btn quiet danger" onClick={() => void clear()} style={{ padding: 0 }}>{en.settings.clearCache}</button>
        </section>

        <section className="panel">
          <h2>{en.settings.libraryPanel}</h2>
          <label className="field">
            <span>{en.settings.defaultLanguage}</span>
            <LanguageSelect value={form.default_language} onChange={(v) => set("default_language", v)} />
            <small>{en.settings.defaultLanguageHelp}</small>
          </label>
          <div className="field" style={{ marginBottom: 0 }}>
            <span>{en.settings.folders}</span>
            {folders.length === 0 ? <p className="muted">{en.settings.noFolders}</p> : (
              <ul className="folder-list" aria-label={en.settings.folders}>
                {folders.map((f) => (
                  <li key={f}>
                    <span>{f}</span>
                    <button type="button" className="btn quiet danger small" onClick={() => setFolders(folders.filter((x) => x !== f))} aria-label={`${en.settings.removeFolder} ${f}`}>{en.settings.removeFolder}</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="inline" style={{ marginTop: 12 }}>
              <input type="text" value={newFolder} placeholder={en.settings.folderPlaceholder} aria-label={en.settings.addFolder} onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFolder(); } }} style={{ flex: "1 1 14rem", fontSize: 15 }} />
              <button type="button" className="btn secondary" onClick={addFolder} disabled={!newFolder.trim()}>{en.settings.addFolder}</button>
            </div>
            <small>{en.settings.foldersHelp}</small>
          </div>
        </section>

        {user && !user.is_guest && (
          <section className="panel">
            <h2>{en.settings.accountsPanel}</h2>
            <label className="check">
              <input type="checkbox" checked={form.allow_guest} disabled={!user.is_admin} onChange={(e) => set("allow_guest", e.target.checked)} />
              <span><strong>{en.settings.allowGuest}</strong><small>{en.settings.allowGuestHelp}</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.allow_registration} disabled={!user.is_admin} onChange={(e) => set("allow_registration", e.target.checked)} />
              <span><strong>{en.settings.allowRegistration}</strong><small>{en.settings.allowRegistrationHelp}</small></span>
            </label>
            {!user.is_admin && <p className="muted">{en.settings.adminOnly}</p>}
          </section>
        )}

        <div className="page-actions">
          <button type="submit" className="btn large">{en.settings.save}</button>
        </div>
        {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      </form>

      {user && !user.is_guest && (
        <>
          <PasswordPanel />
          {user.is_admin && <UsersPanel me={user} />}
        </>
      )}
    </>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const submit = async () => {
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setNotice({ kind: "ok", text: en.settings.passwordChanged });
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  return (
    <section className="panel" style={{ marginTop: 40 }}>
      <h2>{en.settings.password}</h2>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field"><span>{en.settings.currentPassword}</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="field"><span>{en.settings.newPassword}</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /><small>{en.account.passwordHelp}</small></label>
        <button type="submit" className="btn secondary" disabled={!current || !next}>{en.settings.password}</button>
        {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      </form>
    </section>
  );
}

function UsersPanel({ me }: { me: UserDto }) {
  const users = useAsync(() => api.users(), []);
  const remove = async (u: UserDto) => {
    if (!window.confirm(en.settings.deleteUserConfirm(u.display_name))) return;
    await api.deleteUser(u.id);
    users.reload();
  };
  return (
    <section className="panel">
      <h2>{en.settings.users}</h2>
      {users.error && <p className="notice error">{users.error.message}</p>}
      <ul className="account-table">
        {(users.data ?? []).map((u) => (
          <li key={u.id}>
            <span>{u.display_name} <span className="muted">({u.username})</span></span>
            {u.is_admin && <span className="tag" style={{ flex: "none" }}>{en.settings.admin}</span>}
            {u.id !== me.id && <button type="button" className="btn quiet danger small" onClick={() => void remove(u)}>{en.settings.deleteUser}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
