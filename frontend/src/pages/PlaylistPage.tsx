import { useMemo, useState } from "react";
import { AddSongs } from "../components/AddSongs";
import { AddToPlaylist } from "../components/AddToPlaylist";
import { Icon } from "../components/Icon";
import { PlaylistCollage } from "../components/PlaylistCollage";
import { PlaylistNameDialog } from "../components/PlaylistNameDialog";
import { SongList } from "../components/SongList";
import { useAsync } from "../hooks/useAsync";
import { useLayout } from "../hooks/useLayout";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { SongDto } from "../services/api";
import { playlistMeta, PlaylistMenu } from "./PlaylistsPage";

export function PlaylistPage({ playlistId }: { playlistId: number }) {
  const list = useAsync(() => api.playlist(playlistId), [playlistId]);
  const library = useAsync(() => api.songs(), []);
  const games = useAsync(() => api.myGames(), []);
  const phone = useLayout() === "phone";
  const [dialog, setDialog] = useState<"rename" | "add" | null>(null);
  const [target, setTarget] = useState<SongDto | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const songs = list.data?.songs ?? [];
  const missing = list.error?.status === 404;
  const removedIds = useMemo(() => new Set(songs.filter((s) => s.removed).map((s) => s.id)), [songs]);
  const candidates = useMemo(() => (library.data ?? []).filter((s) => !songs.some((x) => x.id === s.id)), [library.data, songs]);

  const reload = () => { list.reload(); library.reload(); };
  const saveOrder = async (ids: number[]) => {
    const byId = new Map(songs.map((s) => [s.id, s]));
    list.setData({ ...list.data!, songs: ids.map((id) => byId.get(id)!) }); // the new order shows at once; the server confirms it
    try { await api.reorderPlaylist(playlistId, ids); } catch (e) { setNotice(e instanceof ApiError ? e.message : en.errors.generic); list.reload(); }
  };
  const takeOut = async (s: SongDto) => {
    try { await api.removeFromPlaylist(playlistId, s.id); setNotice(null); list.reload(); } catch (e) { setNotice(e instanceof ApiError ? e.message : en.errors.generic); }
  };
  const removeFromLibrary = async (s: SongDto) => {
    if (!window.confirm(s.source === "library" ? en.library.removeLibrary(s.title) : en.library.removeCopy(s.title))) return;
    await api.deleteSong(s.id);
    reload();
  };

  if (missing) return <p className="empty">{en.playlists.notFound} <a href={paths.playlists()}>{en.playlists.back}</a></p>;
  return (
    <>
      <a className="back-link" href={paths.playlists()}>← {en.playlists.back}</a>
      {list.data && (
        <section className="playlist-head">
          <PlaylistCollage covers={songs.filter((s) => !s.removed).slice(0, 4).map((s) => ({ id: s.id, title: s.title, has_cover: s.has_cover }))} size="large" />
          <div className="playlist-title">
            <h1>{list.data.name}</h1>
            <div className="count">{playlistMeta(list.data)}</div>
          </div>
          <div className="page-actions">
            <button type="button" className="btn secondary" onClick={() => setDialog("add")}><Icon name="add" />{en.playlists.addSongs}</button>
            <button type="button" className="kebab" aria-haspopup="menu" aria-label={en.playlists.menu(list.data.name)} onClick={(e) => setMenu(menu ? null : e.currentTarget)}><Icon name="more" /></button>
          </div>
        </section>
      )}
      {notice && <p className="notice error" role="alert">{notice}</p>}
      {list.data && songs.length === 0 && (
        <div className="empty-card"><strong>{en.playlists.emptyList}</strong><p className="muted">{en.playlists.emptyListHelp}</p><button type="button" className="btn" onClick={() => setDialog("add")}>{en.playlists.addSongs}</button></div>
      )}
      <SongList
        songs={songs} games={games.data ?? []} phone={phone} sortKey={null} listKey={`pl${playlistId}`} reload={reload} onRemove={(s) => void removeFromLibrary(s)}
        removed={(s) => removedIds.has(s.id)}
        reorder={{ onReorder: (ids) => void saveOrder(ids) }}
        extras={() => [{ id: "playlist", icon: "playlistAdd", label: en.playlists.addTo }, { id: "unlist", icon: "close", label: en.playlists.removeFrom, danger: true }]}
        onExtra={(id, s) => { if (id === "playlist") setTarget(s); else void takeOut(s); }}
      />
      {menu && list.data && <PlaylistMenu phone={phone} anchor={menu} title={list.data.name} onClose={() => setMenu(null)} onRename={() => setDialog("rename")}
        onDelete={() => { if (window.confirm(en.playlists.deleteConfirm(list.data!.name))) void api.deletePlaylist(playlistId).then(() => { location.hash = paths.playlists(); }); }} />}
      {dialog === "rename" && list.data && <PlaylistNameDialog title={en.playlists.renameTitle} action={en.playlists.save} initial={list.data.name} onClose={() => setDialog(null)} onSubmit={async (n) => { await api.renamePlaylist(playlistId, n); list.reload(); }} />}
      {dialog === "add" && <AddSongs songs={candidates} onClose={() => setDialog(null)} onAdd={async (ids) => { await api.addToPlaylist(playlistId, ids); list.reload(); }} />}
      {target && <AddToPlaylist songIds={[target.id]} subtitle={`${target.title} · ${target.artist}`} onClose={() => setTarget(null)} onChanged={list.reload} />}
    </>
  );
}
