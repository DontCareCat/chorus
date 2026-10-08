import { useEffect } from "react";
import { en } from "./i18n/en";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { GamePage } from "./pages/GamePage";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SongPage } from "./pages/SongPage";
import { paths, useRoute } from "./router";

export function App() {
  const route = useRoute();
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const needsSignIn = !auth.loading && auth.user === null;

  // Nobody may use the server without an account (guests are off): everything leads to the sign-in page.
  useEffect(() => {
    if (needsSignIn && route.name !== "login") location.hash = paths.login();
  }, [needsSignIn, route.name]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href={paths.library()}>
          <span className="bars" aria-hidden="true"><i /><i /><i /></span>
          {en.appName}
        </a>
        <div className="top-right">
          <nav aria-label="Main">
            <a href={paths.library()} aria-current={route.name === "library" || route.name === "song" ? "page" : undefined}>{en.nav.library}</a>
            <a href={paths.settings()} aria-current={route.name === "settings" ? "page" : undefined}>{en.nav.settings}</a>
          </nav>
          <div className="account">
            {auth.user ? (
              <>
                <strong>{auth.user.display_name}</strong>
                {auth.user.is_guest ? (
                  <a href={paths.login()}>{en.account.signIn}</a>
                ) : (
                  <button type="button" className="btn quiet small" onClick={() => void auth.signOut().then(() => { location.hash = paths.library(); })}>{en.account.signOut}</button>
                )}
              </>
            ) : (
              !auth.loading && <a href={paths.login()}>{en.account.signIn}</a>
            )}
          </div>
          <div className="theme-switch" role="group" aria-label={en.theme.label}>
            {(["light", "dark"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>{en.theme[t]}</button>
            ))}
          </div>
        </div>
      </header>
      <main>
        {auth.loading && <p className="muted">…</p>}
        {!auth.loading && route.name === "login" && <LoginPage />}
        {!auth.loading && !needsSignIn && route.name === "library" && <LibraryPage />}
        {!auth.loading && !needsSignIn && route.name === "song" && <SongPage songId={route.songId} key={route.songId} />}
        {!auth.loading && !needsSignIn && route.name === "game" && <GamePage publicId={route.publicId} key={route.publicId} />}
        {!auth.loading && !needsSignIn && route.name === "settings" && <SettingsPage />}
        {!auth.loading && route.name === "notfound" && <p className="empty">Page not found. <a href={paths.library()}>{en.nav.library}</a></p>}
      </main>
    </div>
  );
}
