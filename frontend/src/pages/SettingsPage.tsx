import { useConfirm } from "../components/Confirm";
import { Dialog } from "../components/Dialog";
import { LEVELS, LevelBars, ProgressiveStars } from "../components/LevelIcon";
import { Select } from "../components/Select";
import { useEffect, useRef, useState } from "react";
import { FolderBrowser } from "../components/FolderBrowser";
import { LANGUAGES } from "../components/LanguageSelect";
import { ActionRow, ChoiceRow, PickerRow, SectionNav, StepperRow, SettingsCard, SwitchRow, TextField, useSectionSpy } from "../components/SettingsKit";
import { noAutofill } from "../lib/noAutofill";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { useLayout } from "../hooks/useLayout";
import { forgetQueueLevel } from "../hooks/useQueueActions";
import { useThumb } from "../hooks/useThumb";
import { useTheme } from "../hooks/useTheme";
import { useLyricFocus } from "../hooks/useLyricFocus";
import type { QueueLevel } from "../lib/queue";
import { Toast, useToast } from "../components/Toast";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import { getEngineKind, setEngineKind } from "../services/audio/create-engine";
import type { EngineKind } from "../services/audio/create-engine";
import type { SettingsDto, UserDto } from "../services/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
/** How far one tap on − or + moves a value: small steps near the bottom, bigger ones as it grows. */
export const minutesStep = (v: number): number => (v < 10 ? 1 : v < 60 ? 5 : v < 180 ? 15 : 60);
export const daysStep = (v: number): number => (v < 14 ? 1 : v < 60 ? 7 : 30);
export const stepValue = (v: number, dir: 1 | -1, step: (v: number) => number, min: number, max: number): number => {
  const next = dir === 1 ? v + step(v) : v - step(v - 1);
  return Math.min(max, Math.max(min, next));
};
const ROLE = (u: UserDto) => (u.is_guest ? en.settings.roles.guest : u.is_admin ? en.settings.roles.admin : en.settings.roles.member);

export function SettingsPage() {
  const { user, state, refresh, signOut } = useAuth();
  const phone = useLayout() === "phone";
  const loaded = useAsync(() => api.settings(), []);
  const about = useAsync(() => api.health(), []);
  const [form, setForm] = useState<SettingsDto | null>(null);
  const [notice, setNotice] = useToast(2500);
  const [dialog, setDialog] = useState<"password" | "terms" | "about" | null>(null);
  const theme = useTheme();
  const lyric = useLyricFocus();
  const queueThumb = useThumb();
  const fadeThumb = useThumb();
  const themeThumb = useThumb<HTMLDivElement>();
  const modeThumb = useThumb();
  const focusThumb = useThumb();
  const audioThumb = useThumb();
  const [kind, setKind] = useState<EngineKind>(getEngineKind);
  const confirm = useConfirm();

  // what has been asked of the server and what is on screen: switches apply at once, saves go one after the other
  const latest = useRef<SettingsDto | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (loaded.data) { latest.current = loaded.data; setForm(loaded.data); } }, [loaded.data]);

  const admin = !!user?.is_admin;
  const show = { server: admin, account: user !== null };
  const sections = [
    ...(show.account ? [{ id: "account", title: en.settings.sections.account }] : []),
    { id: "appearance", title: en.settings.sections.appearance },
    { id: "lyrics", title: en.settings.sections.lyrics },
    { id: "playing", title: en.settings.sections.playing },
    { id: "dictionary", title: en.settings.sections.dictionary },
    { id: "library", title: en.settings.sections.library },
    ...(show.server ? [{ id: "server", title: en.settings.sections.server }] : []),
    { id: "about", title: en.settings.sections.about },
  ];
  const [current, jump] = useSectionSpy(sections.map((s) => s.id));

  if (loaded.error) return <p className="notice error">{loaded.error.message}</p>;
  if (!form) { // the page's frame is already in place: the heading, the section list and an empty card, so nothing moves when the settings arrive
    return (
      <>
        <div className="page-head"><h1>{en.settings.title}</h1></div>
        <div className="settings-layout" data-phone={phone || undefined}>
          <SectionNav sections={sections} current={current} onJump={jump} phone={phone} />
          <div className="settings-body" aria-busy="true"><section className="scard"><h2 className="scard-label">{sections[0]!.title}</h2><div className="scard-body sk-card" /></section></div>
        </div>
      </>
    );
  }

  /** Change settings: shown now, saved in the background, the floating "Saved" says when it is done. */
  const apply = (patch: Partial<SettingsDto>, done: string = en.settings.saved): Promise<void> => {
    const next = { ...latest.current!, ...patch };
    latest.current = next;
    setForm(next);
    const run = async () => {
      try {
        const saved = await api.saveSettings(latest.current!);
        if (latest.current === next) { latest.current = saved; setForm(saved); }
        setNotice({ kind: "ok", text: done });
      } catch (e) {
        setNotice({ kind: "error", text: msg(e) });
        const fresh = await api.settings().catch(() => null);
        if (fresh) { latest.current = fresh; setForm(fresh); }
      }
    };
    chain.current = chain.current.then(run);
    return chain.current;
  };
  const account = (changes: Parameters<typeof api.updateAccount>[0]) =>
    void api.updateAccount(changes).then(() => refresh()).then(() => setNotice({ kind: "ok", text: en.settings.saved }), (e) => setNotice({ kind: "error", text: msg(e) }));
  const retryLyrics = async () => {
    try {
      const r = await api.retryLyrics();
      setNotice({ kind: "ok", text: en.library.lyricsQueued(r.queued) });
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  const clear = async () => {
    if (!(await confirm({ title: en.settings.clearConfirm, body: en.settings.clearConfirmBody, action: en.settings.clearAction }))) return;
    const r = await api.clearCache();
    setNotice({ kind: "ok", text: en.settings.cacheCleared(r.deleted) });
  };
  const forever = form.lyrics_cache_ttl_days === 0;
  const dailyOptions = [0, 10, 20, 40, 60, 100, 200, 500].concat(user && ![0, 10, 20, 40, 60, 100, 200, 500].includes(user.daily_card_limit) ? [user.daily_card_limit] : []).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b)).map((n) => ({ value: n, label: n === 0 ? en.settings.unlimited : String(n) }));
  const languageOptions = (value: string) => [...(LANGUAGES.some((l) => l.code === value) || !value ? [] : [{ value, label: value.toUpperCase() }]), ...LANGUAGES.map((l) => ({ value: l.code, label: `${l.name} (${l.code.toUpperCase()})` }))];

  const body = (
    <div className="settings-body">
      {user && (
        <SettingsCard id="account" title={en.settings.sections.account}>
          <div className="srow" data-kind="account">
            <span className="avatar" aria-hidden="true">{(user.display_name || "?").trim().charAt(0).toUpperCase()}</span>
            <div className="srow-text"><strong>{user.display_name}</strong><small>{ROLE(user)}</small></div>
          </div>
          {user.is_guest ? (
            <ActionRow title={en.account.signIn} help={en.settings.guestHelp}>
              <a className="btn secondary small" href={paths.login()}>{en.account.signIn}</a>
              {state?.allow_registration && <a className="btn small" href={paths.register()}>{en.account.createLink}</a>}
            </ActionRow>
          ) : (
            <>
              <ActionRow title={en.settings.changePassword}><button type="button" className="btn secondary small" onClick={() => setDialog("password")}>{en.settings.changePassword}</button></ActionRow>
              <ActionRow title={en.account.signOut}><button type="button" className="btn secondary small" onClick={() => void signOut().then(() => { location.hash = paths.library(); })}>{en.account.signOut}</button></ActionRow>
            </>
          )}
        </SettingsCard>
      )}

      <SettingsCard id="appearance" title={en.settings.sections.appearance}>
        <ChoiceRow title={en.theme.label}>
          <div className="segmented thumbs" role="group" aria-label={en.theme.label} ref={themeThumb}>
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme.theme === t} onClick={() => theme.setTheme(t)}>{en.theme[t]}</button>
            ))}
          </div>
        </ChoiceRow>
      </SettingsCard>

      <SettingsCard id="lyrics" title={en.settings.sections.lyrics}>
        <LyricsService form={form} admin={admin} apply={apply} />
        <SwitchRow title={en.settings.autoFetchShort} checked={form.auto_fetch_lyrics} onChange={(v) => void apply({ auto_fetch_lyrics: v })} />
        <SwitchRow title={en.settings.autoPickShort} help={en.settings.autoPickShortHelp} checked={form.auto_pick_closest} onChange={(v) => void apply({ auto_pick_closest: v })} />
        <SwitchRow title={en.settings.allowUnsyncedShort} help={en.settings.allowUnsyncedShortHelp} checked={form.allow_unsynchronized_lyrics} onChange={(v) => void apply({ allow_unsynchronized_lyrics: v })} />
        <StepperRow
          title={en.settings.timeoutShort} value={form.lyrics_timeout_minutes} label={en.settings.minutes(form.lyrics_timeout_minutes)}
          canDown={form.lyrics_timeout_minutes > 1} canUp={form.lyrics_timeout_minutes < 1440}
          onStep={(d) => void apply({ lyrics_timeout_minutes: stepValue(form.lyrics_timeout_minutes, d, minutesStep, 1, 1440) })}
        />
        <StepperRow
          title={en.settings.cacheShort} value={form.lyrics_cache_ttl_days} label={forever ? "∞" : en.settings.days(form.lyrics_cache_ttl_days)} disabled={forever}
          canDown={form.lyrics_cache_ttl_days > 1} canUp={form.lyrics_cache_ttl_days < 3650}
          onStep={(d) => void apply({ lyrics_cache_ttl_days: stepValue(form.lyrics_cache_ttl_days, d, daysStep, 1, 3650) })}
        >
          <label className="check">
            <input type="checkbox" checked={forever} onChange={(e) => void apply({ lyrics_cache_ttl_days: e.target.checked ? 0 : 30 })} />
            <span>{en.settings.cacheForever}</span>
          </label>
        </StepperRow>
        <ActionRow title={en.settings.retryLyrics} help={en.settings.retryLyricsHelp}>
          <button type="button" className="btn secondary small" onClick={() => void retryLyrics()}>{en.settings.retryLyrics}</button>
        </ActionRow>
        <ActionRow title={en.settings.clearCache}>
          <button type="button" className="btn quiet bordered danger small" onClick={() => void clear()}>{en.settings.clearCache}</button>
        </ActionRow>
      </SettingsCard>

      <SettingsCard id="playing" title={en.settings.sections.playing}>
        <ChoiceRow title={en.queue.settingsLabel} help={en.queue.progressiveHelp}>
          <div className="segmented queue-levels thumbs" role="group" aria-label={en.queue.settingsLabel} ref={queueThumb}>
            {(["progressive", ...LEVELS] as QueueLevel[]).map((l) => (
              <button key={l} type="button" aria-pressed={form.default_queue_difficulty === l} onClick={() => { void apply({ default_queue_difficulty: l }); forgetQueueLevel(); }}>
                {l === "progressive" ? <><span>{en.queue.progressive}</span><ProgressiveStars /></> : <><LevelBars level={l} /><span>{en.library.difficulty[l]}</span></>}
              </button>
            ))}
          </div>
        </ChoiceRow>
        <SwitchRow title={en.queue.autoplay} help={en.queue.autoplayHelp} checked={form.queue_autoplay} onChange={(v) => void apply({ queue_autoplay: v })} />
        <SwitchRow title={en.queue.fade} help={en.queue.fadeHelp} checked={form.queue_fade} onChange={(v) => void apply({ queue_fade: v })} />
        <ChoiceRow title={en.queue.fadeLength} dim={!form.queue_fade} help={form.queue_fade ? en.queue.fadeHint(form.queue_fade_seconds) : en.queue.fadeOffHint}>
          <div className="segmented fade-seconds thumbs" role="group" aria-label={en.queue.fadeLength} ref={fadeThumb}>
            {[2, 4, 6, 8].map((n) => (
              <button key={n} type="button" aria-pressed={form.queue_fade_seconds === n} disabled={!form.queue_fade} onClick={() => void apply({ queue_fade_seconds: n })}>{en.queue.fadeSeconds(n)}</button>
            ))}
          </div>
        </ChoiceRow>
        <ChoiceRow title={en.settings.lyricFocus} help={lyric.focus === "question" ? en.settings.lyricFocusQuestionHelp : en.settings.lyricFocusLineHelp}>
          <div className="segmented thumbs" role="group" aria-label={en.settings.lyricFocus} ref={focusThumb}>
            <button type="button" aria-pressed={lyric.focus === "question"} onClick={() => { lyric.setFocus("question"); setNotice({ kind: "ok", text: en.settings.saved }); }}>{en.settings.lyricFocusQuestion}</button>
            <button type="button" aria-pressed={lyric.focus === "line"} onClick={() => { lyric.setFocus("line"); setNotice({ kind: "ok", text: en.settings.saved }); }}>{en.settings.lyricFocusLine}</button>
          </div>
        </ChoiceRow>
        <ChoiceRow title={en.settings.audioPanel} help={en.settings.audioHelp}>
          <div className="segmented thumbs" role="group" aria-label={en.settings.audioPanel} ref={audioThumb}>
            {(["webaudio", "direct"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} title={en.settings.audio[k].help} onClick={() => { setEngineKind(k); setKind(k); setNotice({ kind: "ok", text: en.settings.saved }); }}>{en.settings.audio[k].name}</button>
            ))}
          </div>
        </ChoiceRow>
      </SettingsCard>

      <SettingsCard id="dictionary" title={en.settings.sections.dictionary}>
        <PickerRow title={en.settings.translateInto} help={en.settings.translateIntoHelp}>
          <Select row ariaLabel={en.settings.translateInto} value={user?.translation_language ?? "en"} options={languageOptions(user?.translation_language ?? "en")} onChange={(code: string) => account({ translation_language: code })} />
        </PickerRow>
        <ChoiceRow title={en.settings.addWordsShort} help={en.settings.addWordsHelp}>
          <div className="segmented thumbs" role="group" aria-label={en.settings.addWordsShort} ref={modeThumb}>
            {(["auto", "manual"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={(user?.dictionary_mode ?? "auto") === m} onClick={() => account({ dictionary_mode: m })}>{m === "auto" ? en.settings.addWordsAuto : en.settings.addWordsManual}</button>
            ))}
          </div>
        </ChoiceRow>
        <PickerRow title={en.settings.dailyLimit} help={en.settings.dailyLimitHelp}>
          <Select row ariaLabel={en.settings.dailyLimit} value={user?.daily_card_limit ?? 0} options={dailyOptions} onChange={(n: number) => account({ daily_card_limit: n })} />
        </PickerRow>
        <SwitchRow title={en.settings.translationShort} help={en.settings.translationEnabledHelp} checked={form.translation_enabled} onChange={(v) => void apply({ translation_enabled: v })} />
      </SettingsCard>

      <SettingsCard id="library" title={en.settings.sections.library}>
        <PickerRow title={en.settings.defaultLanguage} help={en.settings.defaultLanguageHelp}>
          <Select row ariaLabel={en.settings.defaultLanguage} value={form.default_language} options={languageOptions(form.default_language)} onChange={(v: string) => void apply({ default_language: v })} />
        </PickerRow>
        <SwitchRow title={en.settings.detectShort} help={en.settings.autoDetectLanguageHelp} checked={form.auto_detect_language} onChange={(v) => void apply({ auto_detect_language: v })} />
        <SwitchRow title={en.settings.coversShort} help={en.settings.autoFetchCoversHelp} checked={form.auto_fetch_covers} onChange={(v) => void apply({ auto_fetch_covers: v })} />
        <div className="srow" data-kind="switch">
          <div className="srow-text">
            <strong>{en.settings.youtubeShort}</strong>
            <small>{en.settings.youtubeShortHelp} <button type="button" className="link-btn" onClick={() => setDialog("terms")}>{en.settings.termsLink}</button></small>
          </div>
          <button type="button" role="switch" className="sw" aria-checked={form.youtube_enabled} aria-label={en.settings.youtubeShort} onClick={() => void apply({ youtube_enabled: !form.youtube_enabled })}><i /></button>
        </div>
        <LibraryFolders form={form} apply={apply} />
      </SettingsCard>

      {admin && user && (
        <SettingsCard id="server" title={en.settings.sections.server}>
          <SwitchRow title={en.settings.allowGuest} help={en.settings.allowGuestHelp} checked={form.allow_guest} onChange={(v) => void apply({ allow_guest: v })} />
          <SwitchRow title={en.settings.allowRegistration} help={en.settings.allowRegistrationHelp} checked={form.allow_registration} onChange={(v) => void apply({ allow_registration: v })} />
          <UsersList me={user} />
        </SettingsCard>
      )}

      <SettingsCard id="about" title={en.settings.sections.about}>
        <ActionRow title={en.appName} help={about.data ? en.settings.versionLine(about.data.version) : undefined} helpClass="about-version">
          <button type="button" className="btn secondary small" onClick={() => setDialog("about")}>{en.settings.aboutLicences}</button>
        </ActionRow>
      </SettingsCard>
    </div>
  );

  return (
    <>
      <div className="page-head"><h1>{en.settings.title}</h1></div>
      <div className="settings-layout" data-phone={phone || undefined}>
        <SectionNav sections={sections} current={current} onJump={jump} phone={phone} />
        {body}
      </div>
      <div className="toast-lane"><Toast toast={notice} pill={notice?.kind === "ok"} onDismiss={() => setNotice(null)} /></div>
      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} onDone={() => setNotice({ kind: "ok", text: en.settings.passwordChanged })} />}
      {dialog === "terms" && (
        <Dialog title={en.settings.termsLink} onClose={() => setDialog(null)}>
          <p>{en.settings.youtubeEnabledHelp}</p>
          <p><a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">{en.settings.youtubeTerms}</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{en.settings.googlePrivacy}</a></p>
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title={en.settings.aboutLicences} onClose={() => setDialog(null)}>
          <p>{about.data ? en.settings.version(about.data.version) : en.appName}</p>
          <p>{en.settings.aboutText}</p>
          <p className="muted">{en.settings.licences}</p>
        </Dialog>
      )}
    </>
  );
}

/** The lyrics service address: the first and most important lyrics setting. Only the administrator edits it; Save checks the server first. */
function LyricsService({ form, admin, apply }: { form: SettingsDto; admin: boolean; apply: (p: Partial<SettingsDto>) => Promise<void> }) {
  const saved = form.lyrics_service_url;
  const [url, setUrl] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [refused, setRefused] = useState(false);
  useEffect(() => setUrl(saved), [saved]);
  const save = async (skipCheck = false) => {
    setBusy(true);
    setStatus(null);
    try {
      if (url.trim() && !skipCheck) {
        setStatus({ ok: true, text: en.settings.checking });
        const r = await api.checkLyricsService(url.trim());
        if (!r.ok) { setStatus({ ok: false, text: r.message }); setRefused(true); return; }
      }
      setRefused(false);
      await apply({ lyrics_service_url: url.trim() });
      setStatus(url.trim() ? { ok: true, text: en.settings.connected } : null);
    } catch (e) {
      setStatus({ ok: false, text: msg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <TextField
      title={en.settings.lyricsService} help={en.settings.lyricsServiceHelp} value={url} saved={saved} readOnly={!admin}
      onChange={(v) => { setUrl(v); setStatus(null); setRefused(false); }} onSave={() => void save()} disabledSave={busy}
      placeholder={en.settings.lyricsServicePlaceholder} note={admin ? undefined : en.settings.lyricsServiceAdminOnly} status={status}
      inputProps={{ type: "url", ...noAutofill("lyrics-service") }}
      extraButtons={refused && <button type="button" className="btn quiet small" disabled={busy} onClick={() => void save(true)}>{en.settings.saveAnyway}</button>}
    />
  );
}

/** Library folders: remove at once; a new folder path has its own Save (named Add folder). */
function LibraryFolders({ form, apply }: { form: SettingsDto; apply: (p: Partial<SettingsDto>) => Promise<void> }) {
  const [path, setPath] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const dirs = form.library_dirs;
  const add = (p: string) => { const f = p.trim(); if (f && !dirs.includes(f)) void apply({ library_dirs: [...dirs, f] }); setPath(""); };
  return (
    <div className="srow" data-kind="folders">
      <div className="srow-text"><strong>{en.settings.folders}</strong><small>{en.settings.foldersHelp}</small></div>
      {dirs.length === 0 ? <p className="muted srow-help">{en.settings.noFolders}</p> : (
        <ul className="folder-list srow-help" aria-label={en.settings.folders}>
          {dirs.map((f) => (
            <li key={f}>
              <span>{f}</span>
              <button type="button" className="btn quiet danger small" onClick={() => void apply({ library_dirs: dirs.filter((x) => x !== f) })} aria-label={`${en.settings.removeFolder} ${f}`}>{en.settings.removeFolder}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="srow-field" autoComplete="off" onSubmit={(e) => { e.preventDefault(); add(path); }}>
        <input type="text" {...noAutofill("library-folder")} value={path} placeholder={en.settings.folderPlaceholder} aria-label={en.settings.addFolder} onChange={(e) => setPath(e.target.value)} />
        <button type="button" className="btn secondary" onClick={() => setBrowsing(true)}>{en.settings.browseFolder}</button>
        <button type="submit" className="btn secondary" disabled={!path.trim()}>{en.settings.addFolder}</button>
      </form>
      {browsing && <FolderBrowser mode="folder" start={path.trim().startsWith("/") ? path.trim() : ""} onClose={() => setBrowsing(false)} onPickFolder={(p) => add(p)} />}
    </div>
  );
}

function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api.changePassword(current, next);
      onDone();
      onClose();
    } catch (e) {
      setError(msg(e));
    }
  };
  return (
    <Dialog title={en.settings.changePassword} onClose={onClose}>
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field"><span>{en.settings.currentPassword}</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setError(null); }} /></label>
        <label className="field"><span>{en.settings.newPassword}</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(null); }} /><small>{en.account.passwordHelp}</small></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="page-actions">
          <button type="button" className="btn secondary" onClick={onClose}>{en.settings.cancel}</button>
          <button type="submit" className="btn" disabled={!current || !next}>{en.settings.save2}</button>
        </div>
      </form>
    </Dialog>
  );
}

function UsersList({ me }: { me: UserDto }) {
  const users = useAsync(() => api.users(), []);
  const confirm = useConfirm();
  const remove = async (u: UserDto) => {
    if (!(await confirm({ title: en.settings.deleteUserConfirm(u.display_name), body: en.settings.deleteUserBody, action: en.settings.deleteUserAction }))) return;
    await api.deleteUser(u.id);
    users.reload();
  };
  return (
    <div className="srow" data-kind="users">
      <div className="srow-text"><strong>{en.settings.users}</strong></div>
      {users.error && <p className="notice error">{users.error.message}</p>}
      <ul className="account-table srow-help">
        {(users.data ?? []).map((u) => (
          <li key={u.id}>
            <span>{u.display_name} <span className="muted">({u.username})</span></span>
            {u.is_admin && <span className="tag" style={{ flex: "none" }}>{en.settings.admin}</span>}
            {u.id !== me.id && <button type="button" className="btn quiet danger small" onClick={() => void remove(u)}>{en.settings.deleteUser}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
