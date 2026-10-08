import { en } from "./i18n/en";
import { GamePage } from "./pages/GamePage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SongPage } from "./pages/SongPage";
import { paths, useRoute } from "./router";

export function App() {
  const route = useRoute();
  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href={paths.library()}>{en.appName}</a>
        <nav aria-label="Main">
          <a href={paths.library()} aria-current={route.name === "library" || route.name === "song" ? "page" : undefined}>{en.nav.library}</a>
          <a href={paths.settings()} aria-current={route.name === "settings" ? "page" : undefined}>{en.nav.settings}</a>
        </nav>
      </header>
      <main>
        {route.name === "library" && <LibraryPage />}
        {route.name === "song" && <SongPage songId={route.songId} key={route.songId} />}
        {route.name === "game" && <GamePage publicId={route.publicId} key={route.publicId} />}
        {route.name === "settings" && <SettingsPage />}
        {route.name === "notfound" && <p className="empty">Page not found. <a href={paths.library()}>{en.nav.library}</a></p>}
      </main>
    </div>
  );
}
