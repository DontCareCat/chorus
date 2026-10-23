import { useEffect, useRef, useState } from "react";
import { en } from "./i18n/en";
import { useAuth } from "./hooks/useAuth";
import { useExitTransition } from "./hooks/useExitTransition";
import { useGameLock, useKeyboardFit, useLayout } from "./hooks/useLayout";
import { useThumb } from "./hooks/useThumb";
import { swallowNextClick } from "./lib/swallow-click";
import { useTheme } from "./hooks/useTheme";
import { QueueBar } from "./components/QueueBar";
import { GamePage } from "./pages/GamePage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlaylistPage } from "./pages/PlaylistPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { DictionaryPage } from "./pages/DictionaryPage";
import { LoginPage } from "./pages/LoginPage";
import { ReviewPage } from "./pages/ReviewPage";
import { ScoresPage } from "./pages/ScoresPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SongPage } from "./pages/SongPage";
import { api } from "./services/api";
import { paths, useRoute } from "./router";

export function App() {
  const route = useRoute();
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const needsSignIn = !auth.loading && auth.user === null && auth.unreachable === null;

  // Nobody may use the server without an account (guests are off): everything leads to the sign-in page.
  useEffect(() => {
    if (needsSignIn && route.name !== "login") location.hash = paths.login();
  }, [needsSignIn, route.name]);

  const layout = useLayout();
  const phone = layout === "phone";
  const isGame = route.name === "game";
  useGameLock(isGame);
  useKeyboardFit(isGame);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cards, setCards] = useState(0);
  const signedIn = auth.user !== null;
  // how many cards are waiting (the badge on "Dictionary"); looked up again whenever the page changes
  useEffect(() => {
    if (!signedIn || route.name === "login") return;
    let live = true;
    api.reviewSummary().then((s) => live && setCards(s.due + s.new), () => undefined);
    return () => { live = false; };
  }, [signedIn, route.name]);
  useEffect(() => setMenuOpen(false), [route.name]);
  const menu = useExitTransition(menuOpen, 220);
  const panelRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  // a tap outside the open phone menu closes it and does nothing else
  useEffect(() => {
    if (!menuOpen) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || burgerRef.current?.contains(t)) return;
      swallowNextClick();
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [menuOpen]);
  const navThumb = useThumb<HTMLElement>();
  const themeThumb = useThumb<HTMLDivElement>();

  const nav = (
    <nav aria-label="Main" className="thumbs" ref={navThumb}>
      <a href={paths.library()} aria-current={route.name === "library" || route.name === "song" || route.name === "playlists" || route.name === "playlist" ? "page" : undefined}>{en.nav.library}</a>
      <a href={paths.dictionary()} aria-current={route.name === "dictionary" || route.name === "review" ? "page" : undefined}>
        {en.nav.dictionary}{cards > 0 && <small className="nav-badge" aria-label={`${cards} cards to review`}>{cards}</small>}
      </a>
      <a href={paths.scores()} aria-current={route.name === "scores" ? "page" : undefined}>{en.nav.scores}</a>
      <a href={paths.settings()} aria-current={route.name === "settings" ? "page" : undefined}>{en.nav.settings}</a>
    </nav>
  );
  const account = (
    <div className="account">
      {auth.user ? (
        <>
          <strong>{auth.user.display_name}</strong>
          {auth.user.is_guest ? (
            <>
              <a className="btn secondary small" href={paths.login()}>{en.account.signIn}</a>
              {auth.state?.allow_registration && <a className="btn small" href={paths.register()}>{en.account.createLink}</a>}
            </>
          ) : (
            <button type="button" className="btn secondary small" onClick={() => void auth.signOut().then(() => { location.hash = paths.library(); })}>{en.account.signOut}</button>
          )}
        </>
      ) : (
        !auth.loading && auth.unreachable === null && <a className="btn secondary small" href={paths.login()}>{en.account.signIn}</a>
      )}
    </div>
  );
  const themeSwitch = (
    <div className="theme-switch thumbs" role="group" aria-label={en.theme.label} ref={themeThumb}>
      {(["light", "dark"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>{en.theme[t]}</button>
      ))}
    </div>
  );

  return (
    <div className="shell" data-route={route.name} data-layout={layout}>
      {!(isGame && phone) && (
        <header className="topbar">
          <a className="wordmark" href={paths.library()}>
            <span className="bars" aria-hidden="true"><i /><i /><i /></span>
            {en.appName}
          </a>
          {phone ? (
            <button type="button" className="menu-btn" ref={burgerRef} aria-expanded={menuOpen} aria-label={en.nav.menu} onClick={() => setMenuOpen((v) => !v)}>
              <svg className="burger" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path className="b1" d="M4 7h16" /><path className="b2" d="M4 12h16" /><path className="b3" d="M4 17h16" /></svg>
            </button>
          ) : (
            <>{nav}<div className="top-right">{account}{themeSwitch}</div></>
          )}
          {phone && menu.mounted && <div className="menu-panel" data-state={menu.state} ref={panelRef}>{nav}{account}{themeSwitch}</div>}
        </header>
      )}
      {!isGame && !needsSignIn && route.name !== "login" && <QueueBar phone={phone} />}
      <main className={isGame ? "game-route" : undefined}>
        {auth.loading && <p className="muted">…</p>}
        {!auth.loading && auth.unreachable !== null && (
          <p className="notice error" role="alert">
            {en.account.unreachable} <button type="button" className="btn secondary small" onClick={() => void auth.refresh()}>{en.account.retry}</button>
          </p>
        )}
        {!auth.loading && auth.unreachable === null && route.name === "login" && <LoginPage signUp={route.name === "login" && route.signUp} key={route.name === "login" && route.signUp ? "up" : "in"} />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "library" && <LibraryPage />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "playlists" && <PlaylistsPage />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "playlist" && <PlaylistPage playlistId={route.playlistId} key={route.playlistId} />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "song" && <SongPage songId={route.songId} key={route.songId} />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "game" && <GamePage publicId={route.publicId} key={route.publicId} />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "settings" && <SettingsPage />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "scores" && <ScoresPage />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "dictionary" && <DictionaryPage />}
        {!auth.loading && auth.unreachable === null && !needsSignIn && route.name === "review" && <ReviewPage />}
        {!auth.loading && route.name === "notfound" && <p className="empty">Page not found. <a href={paths.library()}>{en.nav.library}</a></p>}
      </main>
    </div>
  );
}
