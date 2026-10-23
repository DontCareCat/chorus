import { en } from "../i18n/en";
import { useThumb } from "../hooks/useThumb";
import { paths } from "../router";

/** Songs | Playlists: the two views of the library, as one sliding-thumb segment (guide section 18). */
export function LibraryTabs({ current }: { current: "songs" | "playlists" }) {
  const thumb = useThumb<HTMLElement>();
  return (
    <nav className="library-tabs segmented thumbs" aria-label={en.playlists.tabs} ref={thumb}>
      <a href={paths.library()} aria-current={current === "songs" ? "page" : undefined}>{en.playlists.songs}</a>
      <a href={paths.playlists()} aria-current={current === "playlists" ? "page" : undefined}>{en.playlists.title}</a>
    </nav>
  );
}
