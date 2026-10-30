import { useConfirm } from "../components/Confirm";
import { LEVELS, LevelBars, ProgressiveStars } from "../components/LevelIcon";
import { Select } from "../components/Select";
import { useEffect, useState } from "react";
import { FolderBrowser } from "../components/FolderBrowser";
import { LanguageSelect } from "../components/LanguageSelect";
import { noAutofill } from "../lib/noAutofill";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { forgetQueueLevel } from "../hooks/useQueueActions";
import { useThumb } from "../hooks/useThumb";
import type { QueueLevel } from "../lib/queue";
import { en } from "../i18n/en";
import { api, ApiError } from "../services/api";
import { getEngineKind, setEngineKind } from "../services/audio/create-engine";
import type { EngineKind } from "../services/audio/create-engine";
import type { SettingsDto, UserDto } from "../services/api";

type Notice = { kind: "ok" | "error"; text: string } | null;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const loaded = useAsync(() => api.settings(), []);
  const about = useAsync(() => api.health(), []);
  const [form, setForm] = useState<SettingsDto | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [forever, setForever] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const queueThumb = useThumb();
  const fadeThumb = useThumb();

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
  const retryLyrics = async () => {
    try {
      const r = await api.retryLyrics();
      setNotice({ kind: "ok", text: en.library.lyricsQueued(r.queued) });
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  const confirm = useConfirm();
  const clear = async () => {
    if (!(await confirm({ title: en.settings.clearConfirm, body: en.settings.clearConfirmBody, action: en.settings.clearAction }))) return;
    const r = await api.clearCache();
    setNotice({ kind: "ok", text: en.settings.cacheCleared(r.deleted) });
  };

  return (
    <>
      <div className="page-head"><h1>{en.settings.title}</h1></div>
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void save(); }}>
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
            <div className="page-actions">
              <button type="button" className="btn secondary" onClick={() => void retryLyrics()}>{en.settings.retryLyrics}</button>
            </div>
            <small>{en.settings.retryLyricsHelp}</small>
          </div>
          <div className="field">
            <span>{en.settings.lyricsTimeout}</span>
            <input type="number" min={1} max={1440} value={form.lyrics_timeout_minutes} onChange={(e) => set("lyrics_timeout_minutes", Math.min(1440, Math.max(1, Number(e.target.value) || 1)))} aria-label={en.settings.lyricsTimeout} style={{ maxWidth: "12rem" }} />
          </div>
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
          <button type="button" className="btn quiet bordered danger" onClick={() => void clear()}>{en.settings.clearCache}</button>
        </section>

        <section className="panel">
          <h2>{en.queue.settingsTitle}</h2>
          <div className="field">
            <span>{en.queue.settingsLabel}</span>
            <div className="segmented queue-levels thumbs" role="group" aria-label={en.queue.settingsLabel} ref={queueThumb}>
              {(["progressive", ...LEVELS] as QueueLevel[]).map((l) => (
                <button key={l} type="button" aria-pressed={form.default_queue_difficulty === l} onClick={() => { set("default_queue_difficulty", l); forgetQueueLevel(); }}>
                  {l === "progressive" ? <><span>{en.queue.progressive}</span><ProgressiveStars /></> : <><LevelBars level={l} /><span>{en.library.difficulty[l]}</span></>}
                </button>
              ))}
            </div>
            <small>{en.queue.progressiveHelp}</small>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.queue_autoplay} onChange={(e) => set("queue_autoplay", e.target.checked)} />
            <span><strong>{en.queue.autoplay}</strong><small>{en.queue.autoplayHelp}</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.queue_fade} onChange={(e) => set("queue_fade", e.target.checked)} />
            <span><strong>{en.queue.fade}</strong><small>{en.queue.fadeHelp}</small></span>
          </label>
          <div className="field fade-length" data-off={!form.queue_fade}>
            <span>{en.queue.fadeLength}</span>
            <div className="segmented thumbs" role="group" aria-label={en.queue.fadeLength} ref={fadeThumb}>
              {[2, 4, 6, 8].map((n) => (
                <button key={n} type="button" aria-pressed={form.queue_fade_seconds === n} disabled={!form.queue_fade} onClick={() => set("queue_fade_seconds", n)}>{en.queue.fadeSeconds(n)}</button>
              ))}
            </div>
            <small>{form.queue_fade ? en.queue.fadeHint(form.queue_fade_seconds) : en.queue.fadeOffHint}</small>
          </div>
        </section>

        <section className="panel">
          <h2>{en.settings.dictionaryPanel}</h2>
          <label className="field">
            <span>{en.settings.translateInto}</span>
            <LanguageSelect value={user?.translation_language ?? "en"} onChange={(code) => { void api.updateAccount({ translation_language: code }).then(() => refresh()).then(() => setNotice({ kind: "ok", text: en.settings.translationSaved }), (e) => setNotice({ kind: "error", text: msg(e) })); }} />
            <small>{en.settings.translateIntoHelp}</small>
          </label>
          <label className="field">
            <span>{en.settings.dailyLimit}</span>
            <Select
              value={user?.daily_card_limit ?? 0}
              onChange={(n: number) => { void api.updateAccount({ daily_card_limit: n }).then(() => refresh()).then(() => setNotice({ kind: "ok", text: en.settings.dailyLimitSaved }), (err) => setNotice({ kind: "error", text: msg(err) })); }}
              options={[0, 10, 20, 40, 60, 100, 200, 500].concat(user && ![0, 10, 20, 40, 60, 100, 200, 500].includes(user.daily_card_limit) ? [user.daily_card_limit] : []).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b)).map((n) => ({ value: n, label: n === 0 ? en.settings.unlimited : String(n) }))}
            />
            <small>{en.settings.dailyLimitHelp}</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.translation_enabled} onChange={(e) => set("translation_enabled", e.target.checked)} />
            <span><strong>{en.settings.translationEnabled}</strong><small>{en.settings.translationEnabledHelp}</small></span>
          </label>
          <div className="field">
            <label className="field"><span>{en.settings.youtubeKey}</span><input type="password" {...noAutofill("youtube-api-key")} autoComplete="new-password" value={form.youtube_api_key === "********" ? "" : form.youtube_api_key} placeholder={form.youtube_api_key === "********" ? en.settings.youtubeKeySaved : ""} onChange={(e) => { const v = e.target.value.trim(); set("youtube_api_key", v === "" && loaded.data?.youtube_api_key === "********" ? "********" : v); }} style={{ fontSize: 15 }} /></label>
            {form.youtube_api_key !== "" && <div><button type="button" className="btn quiet small" onClick={() => set("youtube_api_key", "")}>{en.settings.youtubeKeyRemove}</button></div>}
            <small>{en.settings.youtubeKeyHelp} <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">{en.settings.youtubeKeyConsole}</a></small>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.youtube_enabled} onChange={(e) => set("youtube_enabled", e.target.checked)} />
            <span>
              <strong>{en.settings.youtubeEnabled}</strong>
              <small>{en.settings.youtubeEnabledHelp} <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">{en.settings.youtubeTerms}</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{en.settings.googlePrivacy}</a></small>
            </span>
          </label>
        </section>

        <section className="panel">
          <h2>{en.settings.libraryPanel}</h2>
          <label className="field">
            <span>{en.settings.defaultLanguage}</span>
            <LanguageSelect value={form.default_language} onChange={(v) => set("default_language", v)} />
            <small>{en.settings.defaultLanguageHelp}</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.auto_detect_language} onChange={(e) => set("auto_detect_language", e.target.checked)} />
            <span><strong>{en.settings.autoDetectLanguage}</strong><small>{en.settings.autoDetectLanguageHelp}</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.auto_fetch_covers} onChange={(e) => set("auto_fetch_covers", e.target.checked)} />
            <span><strong>{en.settings.autoFetchCovers}</strong><small>{en.settings.autoFetchCoversHelp}</small></span>
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
              <input type="text" {...noAutofill("library-folder")} value={newFolder} placeholder={en.settings.folderPlaceholder} aria-label={en.settings.addFolder} onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFolder(); } }} style={{ flex: "1 1 14rem", fontSize: 15 }} />
              <button type="button" className="btn secondary" onClick={() => setBrowsing(true)}>{en.settings.browseFolder}</button>
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

        {browsing && (
          <FolderBrowser mode="folder" start={newFolder.trim().startsWith("/") ? newFolder.trim() : ""} onClose={() => setBrowsing(false)}
            onPickFolder={(p) => setFolders((f) => (f.includes(p) ? f : [...f, p]))} />
        )}
        <AudioPanel />

        <div className="save-bar">
          {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
          <button type="submit" className="btn large">{en.settings.save}</button>
        </div>
      </form>

      {user && !user.is_guest && (
        <>
          <PasswordPanel />
          {user.is_admin && <UsersPanel me={user} />}
        </>
      )}
      {about.data && <p className="hint about">{en.settings.version(about.data.version)}</p>}
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
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
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
  const confirm = useConfirm();
  const remove = async (u: UserDto) => {
    if (!(await confirm({ title: en.settings.deleteUserConfirm(u.display_name), body: en.settings.deleteUserBody, action: en.settings.deleteUserAction }))) return;
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

/** Which audio path the game uses on THIS device (kept in this browser, not on the server). */
function AudioPanel() {
  const [kind, setKind] = useState<EngineKind>(getEngineKind);
  const choose = (k: EngineKind) => {
    setEngineKind(k);
    setKind(k);
  };
  return (
    <section className="panel">
      <h2>{en.settings.audioPanel}</h2>
      <p className="muted" style={{ marginBottom: 14 }}>{en.settings.audioHelp}</p>
      {(["webaudio", "direct"] as const).map((k) => (
        <label className="check" key={k}>
          <input type="radio" name="audio-engine" checked={kind === k} onChange={() => choose(k)} />
          <span><strong>{en.settings.audio[k].name}</strong><small>{en.settings.audio[k].help}</small></span>
        </label>
      ))}
    </section>
  );
}
