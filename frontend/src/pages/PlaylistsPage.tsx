import { useConfirm } from "../components/Confirm";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { LibraryTabs } from "../components/LibraryTabs";
import { PlaylistCollage } from "../components/PlaylistCollage";
import { PlaylistNameDialog } from "../components/PlaylistNameDialog";
import { Sheet } from "../components/Sheet";
import type { SheetApi } from "../components/Sheet";
import { useAsync } from "../hooks/useAsync";
import { useLayout } from "../hooks/useLayout";
import { en } from "../i18n/en";
import { swallowNextClick } from "../lib/swallow-click";
import { paths } from "../router";
import { api } from "../services/api";
import type { PlaylistDto } from "../services/api";

export const playlistMeta = (p: { song_count: number; duration: number }) => en.playlists.count(p.song_count, Math.round(p.duration / 60));

export function PlaylistsPage() {
  const lists = useAsync(() => api.playlists(), []);
  const phone = useLayout() === "phone";
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "rename"; list: PlaylistDto } | null>(null);
  const [menu, setMenu] = useState<{ list: PlaylistDto; anchor: HTMLElement } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const confirm = useConfirm();
  const remove = async (p: PlaylistDto) => {
    if (!(await confirm({ title: en.playlists.deleteConfirm(p.name), body: en.playlists.deleteConfirmBody, action: en.playlists.deleteAction }))) return;
    await api.deletePlaylist(p.id);
    lists.reload();
  };

  return (
    <>
      <section className="page-head">
        <div>
          <h1>{en.library.title}</h1>
          <LibraryTabs current="playlists" />
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setDialog({ kind: "new" })}><Icon name="add" />{en.playlists.create}</button>
        </div>
      </section>
      {lists.error && <p className="notice error">{lists.error.message}</p>}
      {lists.data && lists.data.length === 0 && <p className="empty">{en.playlists.empty}</p>}
      <ul className="playlists">
        {(lists.data ?? []).map((p) => (
          <li key={p.id} className="playlist-row">
            <a className="playlist-main" href={paths.playlist(p.id)} aria-label={en.playlists.open(p.name)}>
              <PlaylistCollage covers={p.covers} />
              <span className="playlist-text">
                <strong>{p.name}</strong>
                <small>{playlistMeta(p)}</small>
              </span>
            </a>
            <button type="button" className="kebab" aria-haspopup="menu" aria-label={en.playlists.menu(p.name)} onClick={(e) => setMenu({ list: p, anchor: e.currentTarget })}><Icon name="more" /></button>
          </li>
        ))}
      </ul>
      {menu && <PlaylistMenu phone={phone} anchor={menu.anchor} title={menu.list.name} onClose={closeMenu}
        onRename={() => setDialog({ kind: "rename", list: menu.list })} onDelete={() => void remove(menu.list)} />}
      {dialog?.kind === "new" && (
        <PlaylistNameDialog title={en.playlists.create} action={en.playlists.createAction} onClose={() => setDialog(null)}
          onSubmit={async (name) => { const p = await api.createPlaylist(name); location.hash = paths.playlist(p.id); }} />
      )}
      {dialog?.kind === "rename" && (
        <PlaylistNameDialog title={en.playlists.renameTitle} action={en.playlists.save} initial={dialog.list.name} onClose={() => setDialog(null)}
          onSubmit={async (name) => { await api.renamePlaylist(dialog.list.id, name); lists.reload(); }} />
      )}
    </>
  );
}

/** Rename / Delete: a popover under the ⋮ on a PC, a bottom sheet on a phone (the same rules as the song menu). */
export function PlaylistMenu({ phone, anchor, title, onClose, onRename, onDelete }: { phone: boolean; anchor: HTMLElement; title: string; onClose: () => void; onRename: () => void; onDelete: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<SheetApi>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (phone) return;
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.max(12, Math.min(r.right - 240, window.innerWidth - 252)), top: r.bottom + 6 });
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor.contains(t)) { swallowNextClick(); onClose(); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); window.removeEventListener("scroll", onClose, true); };
  }, [anchor, onClose, phone]);
  const items = (done: () => void) => (
    <>
      <button type="button" role="menuitem" className="mi" onClick={() => { onRename(); done(); }}><Icon name="edit" /><span>{en.playlists.rename}</span></button>
      <hr />
      <button type="button" role="menuitem" className="mi danger" onClick={() => { onDelete(); done(); }}><Icon name="trash" /><span>{en.playlists.delete}</span></button>
    </>
  );
  if (phone) return <Sheet ref={sheet} label={title} className="song-sheet" onClose={onClose}><header className="sheet-head"><strong>{title}</strong></header><div role="menu">{items(() => sheet.current?.close())}</div></Sheet>;
  return <div className="song-menu" role="menu" aria-label={title} ref={box} style={{ left: pos?.left ?? -9999, top: pos?.top, width: 240 }}>{items(onClose)}</div>;
}
