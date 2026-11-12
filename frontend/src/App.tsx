import { useEffect, useState } from "react";
import { en } from "./i18n/en";
import { useAuth } from "./hooks/useAuth";
import { useGameLock, useKeyboardFit, useLayout } from "./hooks/useLayout";
import { MainNav } from "./components/MainNav";
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
  const [cards, setCards] = useState(0);
  const [wave, setWave] = useState(0); // counts wordmark clicks; a new key restarts the bar animation
  const signedIn = auth.user !== null;
  // how many cards are waiting (the badge on "Dictionary"); looked up again whenever the page changes
  useEffect(() => {
    if (!signedIn || route.name === "login") return;
    let live = true;
    api.reviewSummary().then((s) => live && setCards(s.due + s.new), () => undefined);
    return () => { live = false; };
  }, [signedIn, route.name]);

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

  const showNav = !isGame && !needsSignIn && route.name !== "login";

  return (
    <div className="shell" data-route={route.name} data-layout={layout} data-nav={showNav ? (phone ? "tabs" : "rail") : undefined}>
      {!(isGame && phone) && (
        <header className="topbar">
          <a className="wordmark" href={paths.library()} onClick={() => setWave((n) => n + 1)}>
            <span className="bars" key={wave} data-wave={wave > 0 || undefined} aria-hidden="true"><i /><i /><i /></span>
            {en.appName}
          </a>
          <div className="top-right">{account}</div>
        </header>
      )}
      {!isGame && !needsSignIn && route.name !== "login" && route.name !== "review" && <QueueBar phone={phone} />}
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
      {showNav && <MainNav variant={phone ? "tabs" : "rail"} route={route.name} cards={cards} />}
    </div>
  );
}
