import { useMemo, useState } from "react";
import { Dialog } from "./Dialog";
import { en } from "../i18n/en";
import { buildMatcher } from "../lib/search";
import { noAutofill } from "../lib/noAutofill";
import type { SongDto } from "../services/api";

/** Pick library songs to put into a playlist: a search field and a checkbox list of what is not in it yet. */
export function AddSongs({ songs, onAdd, onClose }: { songs: SongDto[]; onAdd: (ids: number[]) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const matcher = useMemo(() => buildMatcher(query, false), [query]);
  const shown = useMemo(() => songs.filter((s) => matcher.test(s)), [songs, matcher]);
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Dialog title={en.playlists.addSongs} onClose={onClose}>
      <input type="search" className="pill" {...noAutofill("playlist-add-search")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en.library.searchPlaceholder} aria-label={en.library.searchPlaceholder} />
      <ul className="pick-list tall" role="group" aria-label={en.playlists.addSongs}>
        {shown.map((s) => (
          <li key={s.id}>
            <button type="button" className="pick-row" aria-pressed={picked.has(s.id)} onClick={() => toggle(s.id)}>
              <span className="pick-box" aria-hidden="true">{picked.has(s.id) ? "✓" : ""}</span>
              <span className="pick-name">{s.title}<small>{s.artist}</small></span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" disabled={busy || picked.size === 0} onClick={() => { setBusy(true); void onAdd([...picked]).then(onClose, () => setBusy(false)); }}>
        {en.playlists.addToTitle(picked.size || 1).replace(/ to$/, "")}
      </button>
    </Dialog>
  );
}
