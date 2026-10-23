import { useState } from "react";
import { Dialog } from "./Dialog";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { api, ApiError } from "../services/api";
import type { PlaylistDto } from "../services/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);

interface Props {
  songIds: number[];
  /** the song's title when it is one song (the dialog's subtitle) */
  subtitle?: string;
  onClose: () => void;
  onChanged?: () => void;
}

/** "Add to playlist": every playlist with a tick when it already holds all the songs; a tap adds (one song: a second tap removes). */
export function AddToPlaylist({ songIds, subtitle, onClose, onChanged }: Props) {
  const lists = useAsync(() => api.playlists(), []);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const single = songIds.length === 1;
  const has = (p: PlaylistDto) => songIds.every((id) => p.song_ids.includes(id));
  const replace = (p: PlaylistDto) => lists.setData((lists.data ?? []).map((x) => (x.id === p.id ? p : x)));

  const toggle = async (p: PlaylistDto) => {
    setBusy(true);
    try {
      if (single && has(p)) {
        replace(await api.removeFromPlaylist(p.id, songIds[0]!));
        setNotice({ kind: "ok", text: en.playlists.removedFrom(p.name) });
      } else if (has(p)) {
        setNotice({ kind: "ok", text: en.playlists.already(p.name) });
      } else {
        const before = p.song_count;
        const next = await api.addToPlaylist(p.id, songIds);
        replace(next);
        setNotice({ kind: "ok", text: en.playlists.added(next.song_count - before, p.name) });
      }
      onChanged?.();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const made = await api.createPlaylist(name);
      const next = await api.addToPlaylist(made.id, songIds);
      lists.setData([...(lists.data ?? []), next].sort((a, b) => a.name.localeCompare(b.name)));
      setNotice({ kind: "ok", text: en.playlists.added(next.song_count, next.name) });
      setName("");
      onChanged?.();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={en.playlists.addToTitle(songIds.length)} subtitle={subtitle} onClose={onClose}>
      <ul className="pick-list" role="group" aria-label={en.playlists.title}>
        {(lists.data ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" className="pick-row" aria-pressed={has(p)} disabled={busy} onClick={() => void toggle(p)}>
              <span className="pick-box" aria-hidden="true">{has(p) ? "✓" : ""}</span>
              <span className="pick-name">{p.name}</span>
              <small>{p.song_count}</small>
            </button>
          </li>
        ))}
      </ul>
      {lists.data && lists.data.length === 0 && <p className="muted">{en.playlists.empty}</p>}
      <form className="inline new-playlist" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input type="text" {...noAutofill("new-playlist")} value={name} onChange={(e) => setName(e.target.value)} placeholder={en.playlists.newInline} aria-label={en.playlists.name} maxLength={120} />
        <button type="submit" className="btn small" disabled={busy || !name.trim()}>{en.playlists.createAction}</button>
      </form>
      {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
    </Dialog>
  );
}
