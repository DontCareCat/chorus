import { Icon, type IconName } from "./Icon";
import { useThumb } from "../hooks/useThumb";
import { en } from "../i18n/en";
import { paths, type Route } from "../router";

const TABS: { id: string; icon: IconName; label: string; href: () => string; on: Route["name"][] }[] = [
  { id: "home", icon: "home", label: en.nav.library, href: paths.library, on: ["library", "song"] },
  { id: "playlists", icon: "queue", label: en.nav.playlists, href: paths.playlists, on: ["playlists", "playlist"] },
  { id: "dictionary", icon: "menuBook", label: en.nav.dictionary, href: paths.dictionary, on: ["dictionary", "review"] },
  { id: "scores", icon: "leaderboard", label: en.nav.scores, href: paths.scores, on: ["scores"] },
  { id: "settings", icon: "tune", label: en.nav.settings, href: paths.settings, on: ["settings"] },
];

/**
 * The main menu: a bottom tab bar on phones, a rail on the left of wider screens. Icon over label; the current tab sits on
 * a sliding --fill pill. `cards` is the number of dictionary cards waiting.
 */
export function MainNav({ variant, route, cards }: { variant: "tabs" | "rail"; route: Route["name"]; cards: number }) {
  const thumb = useThumb<HTMLElement>();
  return (
    <nav aria-label="Main" className="main-nav thumbs" data-variant={variant} ref={thumb}>
      {TABS.map((t) => (
        <a key={t.id} href={t.href()} data-tab={t.id} aria-current={t.on.includes(route) ? "page" : undefined}>
          <span className="tab-icon">
            <Icon name={t.icon} />
            {t.id === "dictionary" && cards > 0 && <small className="nav-badge" aria-label={`${cards} cards to review`}>{cards}</small>}
          </span>
          <span className="tab-label">{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
