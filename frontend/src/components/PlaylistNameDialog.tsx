import { useState } from "react";
import { Dialog } from "./Dialog";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { ApiError } from "../services/api";

/** One text field in a dialog: the name of a new playlist, or the new name of one. */
export function PlaylistNameDialog({ title, initial = "", action, onSubmit, onClose }: { title: string; initial?: string; action: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span>{en.playlists.name}</span>
          <input type="text" autoFocus {...noAutofill("playlist-name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={en.playlists.namePlaceholder} maxLength={120} />
        </label>
        <button type="submit" className="btn" disabled={busy || !name.trim()}>{action}</button>
        {error && <p className="notice error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
