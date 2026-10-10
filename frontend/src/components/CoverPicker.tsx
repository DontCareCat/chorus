import { useRef, useState } from "react";
import { en } from "../i18n/en";
import { api, ApiError } from "../services/api";
import type { CoverCandidateDto, SongDto } from "../services/api";
import { Cover } from "./Cover";

interface Props {
  song: SongDto;
  /** The song changed (a cover was saved or removed). */
  onChanged: () => void;
}

/** Cover tools on the song page: where the cover comes from, a search that lists candidates to choose from, an upload. */
export function CoverPicker({ song, onChanged }: Props) {
  const [candidates, setCandidates] = useState<CoverCandidateDto[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof ApiError ? (e.code === "covers_unavailable" ? en.cover.unavailable : e.message) : en.errors.generic });
    } finally {
      setBusy(false);
    }
  };
  const changed = (text: string) => {
    setCandidates(null);
    setVersion((v) => v + 1);
    setNotice({ kind: "ok", text });
    onChanged();
  };
  const search = () => run(async () => setCandidates(await api.coverCandidates(song.id, q.trim() || undefined)));
  const auto = () =>
    run(async () => {
      const r = await api.coverAuto(song.id);
      if (r.status === "online") return changed(en.cover.saved);
      setCandidates(await api.coverCandidates(song.id));
      onChanged();
    });
  const choose = (c: CoverCandidateDto) => run(async () => { await api.coverChoose(song.id, c.id); changed(en.cover.saved); });
  const upload = (f: File | undefined) =>
    f && run(async () => {
      await api.coverUpload(song.id, f);
      if (file.current) file.current.value = "";
      changed(en.cover.saved);
    });
  const remove = () => run(async () => { await api.coverRemove(song.id); changed(en.cover.removed); });

  const source = song.cover_source;
  const status = !song.has_cover && source === "none" ? en.cover.notFound : source && source in en.cover ? (en.cover as Record<string, string>)[source] : en.cover.none;
  const removable = source === "online" || source === "custom";

  return (
    <section className="panel cover-picker">
      <h2>{en.cover.title}</h2>
      <div className="cover-now">
        <Cover songId={song.id} title={song.title} hasCover={song.has_cover} size="large" version={version} />
        <p className="muted">{status}</p>
      </div>
      <div className="page-actions" style={{ marginTop: 14 }}>
        <button type="button" className="btn small" onClick={() => void auto()} disabled={busy}>{busy ? en.cover.searching : song.has_cover ? en.cover.searchAgain : en.cover.search}</button>
        <label className="btn secondary small">
          {en.cover.upload}
          <input ref={file} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {removable && <button type="button" className="btn quiet danger small" onClick={() => void remove()} disabled={busy}>{en.cover.remove}</button>}
      </div>
      <form className="inline" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <label className="field">
          <span>{en.cover.searchField}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={song.album ?? song.title} />
        </label>
        <button type="submit" className="btn secondary" disabled={busy}>{en.song.search}</button>
      </form>
      <p className="hint">{en.cover.privacy}</p>
      {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
      {candidates && candidates.length === 0 && <p className="muted">{en.cover.noCandidates}</p>}
      {candidates && candidates.length > 0 && (
        <ul className="cover-grid">
          {candidates.map((c) => (
            <li key={c.id}>
              <div className="cover" data-size="xl"><img src={api.coverCandidateImage(song.id, c.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /></div>
              <strong>{c.title}</strong>
              <small>{[c.artist, c.date?.slice(0, 4)].filter(Boolean).join(" · ")}</small>
              <button type="button" className="btn secondary small" onClick={() => void choose(c)} disabled={busy}>{en.cover.use}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
