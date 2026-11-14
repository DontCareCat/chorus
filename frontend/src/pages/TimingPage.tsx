import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { Marquee } from "../components/Marquee";
import { Sheet } from "../components/Sheet";
import type { SheetApi } from "../components/Sheet";
import { TimingStrip } from "../components/TimingStrip";
import { useAsync } from "../hooks/useAsync";
import { useLayout } from "../hooks/useLayout";
import { useVolume } from "../hooks/useVolume";
import { en } from "../i18n/en";
import { buildLrc, lrcFileName } from "../lib/lrc-writer";
import { loadPeaks } from "../lib/peaks";
import { noAutofill } from "../lib/noAutofill";
import { swallowNextClick } from "../lib/swallow-click";
import { saveFile } from "../lib/save-file";
import { notify } from "../lib/notice";
import {
  changeOf, editedCount, emptyHistory, fmt, fmtNow, nudge, parseTime, place, record, redo as redoStep, r2, sameTimes, setNow, shiftAll, signedSeconds,
  timedCount, undo as undoStep,
} from "../lib/timing-edit";
import type { History, Times } from "../lib/timing-edit";
import { closeTip, rippleOn, setRipple, tipClosed } from "../lib/timing-prefs";
import { blockNavigation, paths } from "../router";
import { ApiError, api } from "../services/api";
import type { SongDto, TimingDto } from "../services/api";
import { createEngine } from "../services/audio/create-engine";
import type { GameEngine } from "../services/audio/engine";
import { createYouTubeEngine } from "../services/audio/youtube-player";
import type { Peaks } from "../game/strip";

type Kind = "phone" | "land" | "wide";
const WINDOW: Record<Kind, number> = { phone: 12, land: 16, wide: 24 };

/** Which of the three drawings the screen gets (guide sections 11 and 20): a phone or a touch tablet upright, a phone or tablet on its side, a PC. */
function useKind(): Kind {
  const layout = useLayout();
  const [wide, setWide] = useState(() => window.innerWidth > window.innerHeight);
  useEffect(() => {
    const on = () => setWide(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // a PC window of 900 px or more gets the wide drawing; a touch screen and anything narrower get the phone's: upright, or on its side
  return layout !== "phone" ? (window.innerWidth >= 900 ? "wide" : "land") : wide ? "land" : "phone";
}

const nudgeLabel = (d: number): string => `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(1)}`;
const leave = () => { if (history.length > 1) history.back(); else location.hash = paths.library(); };

/** The lyrics timing editor (design guide section 26): one start time per lyric line; the words themselves cannot be changed. */
export function TimingPage({ songId }: { songId: number }) {
  const songs = useAsync(() => api.songs(), []);
  const timing = useAsync(() => api.timing(songId), [songId]);
  const song = songs.data?.find((s) => s.id === songId);
  const failed = timing.error ?? songs.error;
  if (failed) return <div className="tm-missing"><p className="notice error">{failed.status === 404 ? en.timing.noLyrics : failed.message}</p><a className="btn secondary" href={paths.library()}>{en.timing.toSongs}</a></div>;
  if (!song || !timing.data) return <div className="tm-missing"><p className="muted">{en.timing.loading}</p></div>;
  return <TimingEditor song={song} data={timing.data} />;
}

interface Dlg { kind: "export" | "shift" | "revert" | "leave" }

function TimingEditor({ song, data }: { song: SongDto; data: TimingDto }) {
  const kind = useKind();
  const n = data.lines.length;
  const original = useMemo<Times>(() => data.lines.map((l) => (l.original == null ? null : r2(l.original))), [data]);
  const [saved, setSaved] = useState<Times>(() => data.lines.map((l) => l.time));
  const [times, setTimes] = useState<Times>(saved);
  const [hist, setHist] = useState<History>(emptyHistory);
  const [sel, setSel] = useState(() => { const first = saved.findIndex((t) => t == null); return first >= 0 ? first : 0; });
  const [ripple, setRippleState] = useState(rippleOn);
  const [hint, setHint] = useState(() => !tipClosed());
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [menu, setMenu] = useState(false);
  const [shift, setShift] = useState(0);
  const [field, setField] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const [now, setNowState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [engineError, setEngineError] = useState(false);
  const youtubeId = song.youtube_id ?? null;
  const duration = song.duration > 0 ? song.duration : data.duration;
  const dirty = !sameTimes(times, saved);
  const edited = editedCount(times, original);
  const timed = timedCount(times);
  const ytHost = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef(0);
  const timesRef = useRef(times);
  timesRef.current = times;

  // ---- playback (its own engine: opening the editor leaves any game paused)
  const engine = useRef<GameEngine | null>(null);
  const [audioEl] = useState(() => { const a = document.createElement("audio"); a.preload = "auto"; return a; });
  useEffect(() => {
    let gone = false, made: GameEngine | null = null;
    const ready = (e: GameEngine) => {
      if (gone) { e.dispose(); return; }
      made = e;
      engine.current = e;
      e.onStateChange((s) => setPlaying(s === "playing"));
      e.onError(() => setEngineError(true));
    };
    if (youtubeId) {
      if (ytHost.current) void createYouTubeEngine(ytHost.current, youtubeId).then(ready, () => setEngineError(true));
    } else {
      audioEl.src = api.audioUrl(song.id);
      document.body.appendChild(audioEl);
      ready(createEngine(audioEl, "direct"));
    }
    return () => { gone = true; made?.dispose(); engine.current = null; audioEl.pause(); audioEl.removeAttribute("src"); audioEl.remove(); };
  }, [audioEl, song.id, youtubeId]);
  const vol = useVolume(engine.current);
  useEffect(() => {
    if (youtubeId) return;
    let gone = false;
    void loadPeaks(song.id, api.audioUrl(song.id), duration).then((p) => { if (!gone) setPeaks(p); });
    return () => { gone = true; };
  }, [song.id, youtubeId, duration]);
  const getTime = useCallback(() => engine.current?.getCurrentTime() ?? 0, []);
  useEffect(() => { // the playback position, ten times a second (the strip reads it every frame by itself)
    const id = setInterval(() => setNowState(getTime()), 100);
    return () => clearInterval(id);
  }, [getTime]);
  const seek = useCallback((t: number) => { const c = Math.min(Math.max(0, t), duration > 0 ? duration : t); void engine.current?.seek(c); setNowState(c); }, [duration]);
  const play = useCallback(() => { void engine.current?.play().catch(() => setEngineError(true)); }, []);
  const pause = useCallback(() => engine.current?.pause(), []);
  const toggle = useCallback(() => { if (engine.current && engine.current.getCurrentTime() >= 0 && playing) pause(); else play(); }, [playing, play, pause]);

  // ---- editing
  const say = useCallback((text: string, undo = false) => {
    setToast({ text, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const opts = { ripple, duration };
  const commit = useCallback((next: Times, then?: () => void) => {
    setHist((h) => record(h, timesRef.current));
    setTimes(next);
    setField(null);
    then?.();
  }, []);
  const rowsRef = useRef<HTMLOListElement>(null);
  const scrollTo = useCallback((i: number) => {
    setTimeout(() => {
      const el = rowsRef.current?.children[i] as HTMLElement | undefined;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }, 0);
  }, []);
  const pushed = (k: number) => { if (k) say(en.timing.movedMore(k), true); };
  const doSet = () => {
    const r = setNow(times, sel, getTime(), opts);
    commit(r.times, () => { setSel(r.next); scrollTo(r.next); pushed(r.pushed); });
    if (hint) { setHint(false); }
  };
  const doNudge = (d: number) => { const r = nudge(times, sel, d, getTime(), opts); commit(r.times, () => pushed(r.pushed)); };
  const select = (i: number) => { setSel(i); setField(null); const t = times[i]; if (t != null) seek(Math.max(0, t - 1)); };
  const choose = (i: number) => { select(i); scrollTo(i); };
  const doReplay = () => { const t = times[sel]; seek(Math.max(0, (t ?? getTime()) - 1.5)); play(); };
  const doUndo = () => { const u = undoStep(hist, times); if (u) { setHist(u.history); setTimes(u.times); setToast(null); setField(null); } };
  const doRedo = () => { const u = redoStep(hist, times); if (u) { setHist(u.history); setTimes(u.times); setField(null); } };
  const doSave = async (): Promise<boolean> => {
    try {
      const view = await api.saveTiming(song.id, timesRef.current);
      const eff = view.lines.map((l) => l.time);
      setSaved(eff);
      if (!sameTimes(eff, timesRef.current)) setTimes(eff);
      say(en.timing.saved);
      return true;
    } catch (e) {
      notify({ kind: "error", text: e instanceof ApiError ? e.message : en.errors.generic });
      return false;
    }
  };
  const toggleRipple = () => { setRippleState((v) => { setRipple(!v); return !v; }); };
  const closeDlg = () => setDlg(null);

  // ---- leaving: the tab, the browser's back button and the page's own back arrow all ask first when something is unsaved
  const leaving = useRef(false); // the person chose to go: nothing asks again
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty && !leaving.current;
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const leaveTo = useRef<string | null>(null);
  useEffect(() => blockNavigation((to) => {
    if (!dirtyRef.current) return false;
    leaveTo.current = to;
    setMenu(false);
    setDlg({ kind: "leave" });
    return true;
  }), []);
  const goBack = () => { if (dirty) { setMenu(false); setDlg({ kind: "leave" }); } else leave(); };
  const finishLeave = () => { leaving.current = true; dirtyRef.current = false; const to = leaveTo.current; leaveTo.current = null; if (to !== null) location.hash = to || "#/"; else leave(); };

  // ---- the keys (a hardware keyboard on any layout)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty) void doSave(); return; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (dlg || menu) return;
    if (mod || e.altKey) return;
    if (target?.getAttribute("role") === "slider" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    if (target?.closest("button, a, [role=menuitem]") && !target.closest(".tm-row") && (e.key === " " || e.key === "Enter")) return; // a focused button keeps its own keys (a lyric row does not: Enter sets, Space plays)
    const k = e.key.toLowerCase();
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "Enter") { e.preventDefault(); doSet(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); choose(Math.max(0, sel - 1)); }
    else if (e.key === "ArrowDown") { e.preventDefault(); choose(Math.min(n - 1, sel + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); doNudge(e.shiftKey ? -0.5 : -0.1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); doNudge(e.shiftKey ? 0.5 : 0.1); }
    else if (k === "r") doReplay();
    else if (k === "j") seek(getTime() - 5);
    else if (k === "l") seek(getTime() + 5);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // the chosen line stays in view when the editor opens
  useLayoutEffect(() => { if (sel > 0) scrollTo(sel); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- what the rows and the summary say
  let cur = -1;
  times.forEach((t, i) => { if (t != null && t <= now) cur = i; });
  const selT = times[sel] ?? null;
  const selOrig = original[sel] ?? null;
  const diff = selT == null || selOrig == null ? null : r2(selT - selOrig);
  const selDiff = diff == null ? (selT == null ? en.timing.noTime : en.timing.isNew) : diff === 0 ? en.timing.original : signedSeconds(diff);
  const status = dirty ? en.timing.statusUnsaved : edited > 0 || data.edited ? en.timing.statusSaved : timed === n ? en.timing.statusOriginal : en.timing.statusTimed(timed, n);
  const plain = !data.synced;
  const preview = useMemo(
    () => buildLrc({ title: song.title, artist: song.artist, album: song.album, duration }, data.lines.map((l, i) => ({ time: times[i] ?? null, text: l.text }))),
    [song, duration, data.lines, times],
  );
  const fileName = lrcFileName(song.artist, song.title);
  const doExport = async () => {
    if (dirty && !(await doSave())) return;
    try {
      const out = await api.exportLrc(song.id);
      await saveFile(out.name, "application/octet-stream", out.bytes);
      setDlg(null);
      say(en.timing.exported(out.name));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      notify({ kind: "error", text: e instanceof ApiError ? e.message : en.errors.generic });
    }
  };

  // ---- parts
  const rows = data.lines.map((l, i) => {
    const t = times[i] ?? null;
    const o = original[i] ?? null;
    const ed = t !== o;
    const change = changeOf(t, o);
    const label = en.timing.rowLabel(i + 1, t == null ? en.timing.rowNoTime : fmt(t), ed && t != null ? (o == null ? en.timing.rowNew : en.timing.rowEdited(change)) : "", l.text || en.timing.instrumental);
    return (
      <li key={i}>
        <button
          type="button" className="tm-row" data-sel={i === sel} data-cur={i === cur} data-past={i < cur} data-edit={ed && t != null} data-untimed={t == null}
          aria-current={i === sel || undefined} aria-label={label} onClick={() => choose(i)}
        >
          <span className="tm-cell">{fmt(t)}</span>
          <span className="tm-text">{l.text || "♪"}</span>
          <span className="tm-change" title={ed && t != null ? (o == null ? en.timing.changeTitleNew : en.timing.changeTitleEdited(change)) : undefined}><span aria-hidden="true">{ed && t != null ? change : ""}</span></span>
        </button>
      </li>
    );
  });
  const strip = (
    <TimingStrip
      getTime={getTime} duration={duration} windowSeconds={WINDOW[kind]} peaks={peaks} times={times} original={original} sel={sel}
      onStart={() => { const was = playing; pause(); return was; }}
      onEnd={(t, was) => { seek(t); if (was) play(); }}
    />
  );
  const playBtn = (
    <button type="button" className="tm-play" onClick={toggle} aria-label={playing ? en.timing.pause : en.timing.play}><Icon name={playing ? "pauseBars" : "playArrow"} /></button>
  );
  const nowLabel = <span className="tm-now tnum" aria-hidden="true">{fmtNow(now)}</span>;
  const nud = (d: number, extra?: string) => (
    <button type="button" className="tm-nud" onClick={() => doNudge(d)} aria-label={d < 0 ? en.timing.earlier(Math.abs(d).toFixed(1)) : en.timing.later(d.toFixed(1))} data-size={extra}>{nudgeLabel(d)}</button>
  );
  const replayBtn = <button type="button" className="tm-nud" onClick={doReplay} aria-label={kind === "wide" ? en.timing.replayKey : en.timing.replay} title={kind === "wide" ? en.timing.replayKey : undefined}><Icon name="replay" /></button>;
  const setBtn = (label: string, extra = "") => (
    <button type="button" className="tm-set" onClick={doSet} aria-label={en.timing.setLabel}>{label}<small>{fmtNow(now)}{extra}</small></button>
  );
  const summary = (
    <div className="tm-summary">
      <span className="eyebrow">{en.timing.lineOf(sel + 1, n)}</span>
      <span className="tm-sel-time tnum">{fmt(selT)}</span>
      <span className="tm-sel-diff tnum" data-changed={!!diff}>{selDiff}</span>
    </div>
  );
  const undoBtn = <button type="button" className="tm-nud" onClick={doUndo} disabled={hist.past.length === 0} aria-label={en.timing.undo}><Icon name="undo" /></button>;
  const hintBox = hint && (
    <div className="tm-hint" role="note">
      <span className="tm-hint-icon"><Icon name="info" /></span>
      <div>{plain && <b>{en.timing.tipPlain} </b>}{en.timing.tip}</div>
      <button type="button" className="tm-ib" aria-label={en.timing.tipClose} onClick={() => { closeTip(); setHint(false); }}><Icon name="close" /></button>
    </div>
  );

  const header = (
    <header className="tm-head">
      <button type="button" className="tm-ib" aria-label={en.timing.back} onClick={goBack}><Icon name="arrowBack" /></button>
      {kind === "wide" && <span className="tm-cover" aria-hidden="true" />}
      <div className="tm-titles">
        <div className="tm-h1row"><h1>{en.timing.title}</h1>{kind !== "phone" && <span className="tm-status" data-dirty={dirty} aria-live="polite">{status}</span>}</div>
        <div className="tm-sub"><Marquee>{kind === "phone" ? <><span className="tm-status" data-dirty={dirty} aria-live="polite">{status}</span> · {song.title}</> : `${song.title} · ${song.artist}`}</Marquee></div>
      </div>
      {kind !== "phone" && <>
        <button type="button" className="tm-ib" onClick={doUndo} disabled={hist.past.length === 0} aria-label={kind === "wide" ? en.timing.undoKey : en.timing.undo} title={kind === "wide" ? en.timing.undoKey : undefined}><Icon name="undo" /></button>
        <button type="button" className="tm-ib" onClick={doRedo} disabled={hist.future.length === 0} aria-label={kind === "wide" ? en.timing.redoKey : en.timing.redo} title={kind === "wide" ? en.timing.redoKey : undefined}><Icon name="redo" /></button>
      </>}
      {kind === "wide" ? (
        <button type="button" className="btn secondary" onClick={() => setDlg({ kind: "export" })} disabled={timed === 0}><Icon name="download" />{en.timing.exportButton}</button>
      ) : (
        <button type="button" className="tm-ib" ref={moreBtn} aria-label={en.timing.more} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><Icon name="more" /></button>
      )}
      <button type="button" className="btn" onClick={() => void doSave()} disabled={!dirty}>{en.timing.save}</button>
    </header>
  );

  const wholeSong = (
    <>
      <button type="button" className="mi" onClick={() => { setShift(0); setDlg({ kind: "shift" }); }} disabled={timed === 0}><Icon name="moveAll" /><span>{en.timing.moveAll}</span></button>
      <RippleRow on={ripple} onToggle={toggleRipple} />
      <button type="button" className="mi" onClick={() => setDlg({ kind: "revert" })} disabled={edited === 0}><Icon name="restore" /><span>{en.timing.revert}</span><span className="mi-hint">{edited ? en.timing.edited(edited) : ""}</span></button>
    </>
  );

  let body: ReactNode;
  if (kind === "wide") {
    body = (
      <>
        <div className="tm-body">
          <div className="tm-list">{hintBox}<ol className="tm-rows" ref={rowsRef} aria-label={en.timing.lines}>{rows}</ol></div>
          <aside className="tm-side">
            <section className="tm-card" aria-label={en.timing.selectedLine}>
              <div className="tm-card-head"><span className="eyebrow">{en.timing.lineOf(sel + 1, n)}</span><span className="tm-sel-diff tnum" data-changed={!!diff}>{selDiff}</span></div>
              <div className="tm-sel-text">{data.lines[sel]?.text || "♪"}</div>
              <label className="tm-field">
                <span>{en.timing.startsAt}</span>
                <input
                  value={field ?? fmt(selT)} {...noAutofill("timing-start")} inputMode="decimal" aria-describedby="tm-fh" onChange={(e) => setField(e.target.value)} onBlur={() => setField(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = parseTime(e.currentTarget.value);
                      if (v == null) { say(en.timing.startsAtBad); return; }
                      const r = place(times, sel, v, opts);
                      commit(r.times, () => pushed(r.pushed));
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") { setField(null); e.currentTarget.blur(); }
                  }}
                />
                <span id="tm-fh" className="muted">{en.timing.startsAtHelp}</span>
              </label>
              <div className="tm-nudges">{nud(-0.5)}{nud(-0.1)}{nud(0.1)}{nud(0.5)}</div>
              <div className="tm-pair">{replayBtn}{setBtn(en.timing.setToNow, " · Enter")}</div>
            </section>
            <section className="tm-card tm-whole" aria-label={en.timing.wholeSong}><div className="eyebrow">{en.timing.wholeSong}</div>{wholeSong}</section>
            <KeysList />
          </aside>
        </div>
        <div className="tm-bar">
          <div className="tm-bar-in">
            {playBtn}{strip}{nowLabel}
            <div className="tm-vol" role="group" aria-label={en.timing.volume}>
              <button type="button" className="tm-ib small" aria-label={en.timing.mute} aria-pressed={vol.muted} onClick={vol.toggleMute}><Icon name={vol.muted || vol.volume === 0 ? "volumeOff" : "volumeUp"} /></button>
              <input type="range" min={0} max={1} step={0.05} value={vol.muted ? 0 : vol.volume} onChange={(e) => vol.setVolume(Number(e.target.value))} aria-label={en.timing.volume} />
            </div>
          </div>
        </div>
      </>
    );
  } else if (kind === "land") {
    body = (
      <div className="tm-body">
        <div className="tm-list">{youtubeId && <YtStage host={ytHost} />}{hintBox}<ol className="tm-rows" ref={rowsRef} aria-label={en.timing.lines}>{rows}</ol></div>
        <aside className="tm-dock">
          {summary}
          <div className="tm-sel-text clamp">{data.lines[sel]?.text || "♪"}</div>
          <div className="tm-player">{playBtn}{strip}{nowLabel}</div>
          <div className="tm-nudges">{nud(-0.5)}{nud(-0.1)}{nud(0.1)}{nud(0.5)}</div>
          <div className="tm-pair">{replayBtn}{setBtn(en.timing.set)}</div>
        </aside>
      </div>
    );
  } else {
    body = (
      <>
        <div className="tm-body">
          <div className="tm-list">{youtubeId && <YtStage host={ytHost} />}{hintBox}<ol className="tm-rows" ref={rowsRef} aria-label={en.timing.lines}>{rows}</ol></div>
        </div>
        <div className="tm-dock">
          <div className="tm-dock-in">
            {summary}
            <div className="tm-player">{playBtn}{strip}{nowLabel}</div>
            <div className="tm-btns">{replayBtn}{nud(-0.1)}{setBtn(en.timing.set)}{nud(0.1)}{undoBtn}</div>
          </div>
        </div>
      </>
    );
  }
  if (youtubeId && kind === "wide") body = <><div className="tm-yt-wide"><YtStage host={ytHost} /></div>{body}</>;

  return (
    <div className="tm" data-kind={kind} data-yt={youtubeId ? "" : undefined}>
      {header}
      {engineError && <p className="notice error tm-error" role="alert">{en.timing.audioFailed}</p>}
      {body}
      {toast && (
        <div className="float-toast tm-toast" data-kind="ok" data-state="open" role="status">
          <span className="toast-icon"><Icon name="check" /></span>
          <span className="toast-text">{toast.text}</span>
          {toast.undo && <button type="button" className="tm-toast-undo" onClick={doUndo}>{en.timing.undo}</button>}
        </div>
      )}
      {menu && kind !== "wide" && (
        <TimingMenu
          phone={kind === "phone"} anchor={moreBtn.current} onClose={() => setMenu(false)}
          redo={kind === "phone" ? { disabled: hist.future.length === 0, run: doRedo } : null}
          onExport={() => setDlg({ kind: "export" })} onShift={() => { setShift(0); setDlg({ kind: "shift" }); }} ripple={ripple} onRipple={toggleRipple}
          onRevert={() => setDlg({ kind: "revert" })} timed={timed} edited={edited}
        />
      )}
      {dlg?.kind === "shift" && (
        <Dialog title={en.timing.moveAllTitle} onClose={closeDlg}>
          <div className="tm-dlg">
            <p className="muted">{en.timing.moveAllHelp}</p>
            <div className="tm-stepper">
              {[-0.5, -0.1].map((d) => <button key={d} type="button" className="tm-nud" onClick={() => setShift((s) => r2(s + d))} aria-label={en.timing.earlier(Math.abs(d).toFixed(1))}>{nudgeLabel(d)}</button>)}
              <output aria-live="polite">{signedSeconds(shift)}</output>
              {[0.1, 0.5].map((d) => <button key={d} type="button" className="tm-nud" onClick={() => setShift((s) => r2(s + d))} aria-label={en.timing.later(d.toFixed(1))}>{nudgeLabel(d)}</button>)}
            </div>
            <div className="tm-actions">
              <button type="button" className="btn secondary" onClick={closeDlg}>{en.timing.cancel}</button>
              <button type="button" className="btn" disabled={shift === 0} onClick={() => { const d = shift; commit(shiftAll(times, d, duration)); closeDlg(); say(en.timing.allMoved(signedSeconds(d)), true); }}>{en.timing.move}</button>
            </div>
          </div>
        </Dialog>
      )}
      {dlg?.kind === "revert" && (
        <Dialog title={en.timing.revertTitle} describedBy="tm-rb" onClose={closeDlg}>
          <div className="tm-dlg">
            <p className="muted" id="tm-rb">{en.timing.revertBody}</p>
            <div className="tm-actions">
              <button type="button" className="btn secondary" autoFocus onClick={closeDlg}>{en.timing.cancel}</button>
              <button type="button" className="btn" onClick={() => { commit(original.slice()); closeDlg(); say(en.timing.wentBack, true); }}>{en.timing.revertAction}</button>
            </div>
          </div>
        </Dialog>
      )}
      {dlg?.kind === "leave" && (
        <Dialog title={en.timing.leaveTitle} describedBy="tm-lb" onClose={closeDlg}>
          <div className="tm-dlg">
            <p className="muted" id="tm-lb">{en.timing.leaveBody}</p>
            <div className="tm-actions">
              <button type="button" className="btn secondary" autoFocus onClick={closeDlg}>{en.timing.keepEditing}</button>
              <button type="button" className="btn secondary danger-text" onClick={() => { setDlg(null); finishLeave(); }}>{en.timing.discard}</button>
              <button type="button" className="btn" onClick={() => void doSave().then((ok) => { if (ok) { setDlg(null); finishLeave(); } })}>{en.timing.save}</button>
            </div>
          </div>
        </Dialog>
      )}
      {dlg?.kind === "export" && (
        <Dialog title={en.timing.exportTitle} describedBy="tm-xh" onClose={closeDlg}>
          <div className="tm-dlg">
            <p className="muted" id="tm-xh">{dirty ? en.timing.exportHelpUnsaved : en.timing.exportHelp}</p>
            <div className="tm-file"><Icon name="download" /><span>{fileName}</span></div>
            <pre className="tm-lrc" aria-label={en.timing.preview} tabIndex={0}>{preview}</pre>
            <div className="tm-actions">
              <button type="button" className="btn secondary" onClick={closeDlg}>{en.timing.cancel}</button>
              <button type="button" className="btn" onClick={() => void doExport()}>{dirty ? en.timing.saveAndExport : en.timing.exportButton}</button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function YtStage({ host }: { host: React.RefObject<HTMLDivElement | null> }) {
  return <div className="tm-yt yt-stage" data-testid="yt-stage"><div className="yt-player" ref={host} /></div>;
}

function RippleRow({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="mi" role="switch" aria-checked={on} onClick={onToggle}>
      <Icon name="ripple" />
      <span className="mi-two"><span>{en.timing.ripple}</span><span className="muted">{en.timing.rippleHelp}</span></span>
      <span className="sw" aria-hidden="true" aria-checked={on}><i /></span>
    </button>
  );
}

function KeysList() {
  const k = en.timing.key;
  const rows: [string[], string][] = [[["Space"], k.play], [["Enter"], k.set], [["↑", "↓"], k.choose], [["←", "→"], k.nudge], [["Shift", "←/→"], k.nudgeShift], [["R"], k.again], [["J", "L"], k.jump], [["Ctrl", "Z"], k.undo], [["Ctrl", "Shift", "Z"], k.redo], [["Ctrl", "S"], k.save], [["Esc"], k.close]];
  return (
    <section className="tm-keys" aria-label={en.timing.keys}>
      <div className="eyebrow">{en.timing.keys}</div>
      {rows.map(([caps, text]) => <div key={text} className="tm-key"><span className="tm-caps">{caps.map((c) => <span key={c} className="kbd">{c}</span>)}</span>{text}</div>)}
    </section>
  );
}

interface MenuProps {
  phone: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  redo: { disabled: boolean; run: () => void } | null;
  onExport: () => void;
  onShift: () => void;
  ripple: boolean;
  onRipple: () => void;
  onRevert: () => void;
  timed: number;
  edited: number;
}

/** The ⋮ menu of the editor: a bottom sheet on a phone, a popover under the button on a phone on its side. */
function TimingMenu({ phone, anchor, onClose, redo, onExport, onShift, ripple, onRipple, onRevert, timed, edited }: MenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<SheetApi>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (phone || !anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.min(Math.max(12, r.right - 340), window.innerWidth - 352), top: r.bottom + 6 });
  }, [phone, anchor]);
  useEffect(() => {
    if (phone) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) { swallowNextClick(); onClose(); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [anchor, onClose, phone]);
  const close = () => { if (phone) sheet.current?.close(); else onClose(); };
  const items = (
    <>
      {redo && <button type="button" role="menuitem" className="mi" onClick={() => { redo.run(); close(); }} disabled={redo.disabled}><Icon name="redo" /><span>{en.timing.redo}</span></button>}
      <button type="button" role="menuitem" className="mi" onClick={() => { onExport(); close(); }} disabled={timed === 0}><Icon name="download" /><span>{en.timing.exportMenu}</span></button>
      <button type="button" role="menuitem" className="mi" onClick={() => { onShift(); close(); }} disabled={timed === 0}><Icon name="moveAll" /><span>{en.timing.moveAll}</span></button>
      <RippleRow on={ripple} onToggle={onRipple} />
      <hr />
      <button type="button" role="menuitem" className="mi" onClick={() => { onRevert(); close(); }} disabled={edited === 0}><Icon name="restore" /><span>{en.timing.revert}</span><span className="mi-hint">{edited ? en.timing.edited(edited) : ""}</span></button>
    </>
  );
  if (phone) return <Sheet ref={sheet} label={en.timing.menu} className="song-sheet" onClose={onClose}><div role="menu" aria-label={en.timing.menu}>{items}</div></Sheet>;
  return <div className="song-menu tm-menu" role="menu" aria-label={en.timing.menu} ref={box} style={{ left: pos?.left ?? -9999, top: pos?.top, width: 340 }}>{items}</div>;
}
