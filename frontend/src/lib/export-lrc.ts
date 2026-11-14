import { ApiError, api } from "../services/api";
import { en } from "../i18n/en";
import { notify } from "./notice";
import { saveFile } from "./save-file";

/** Saves a song's lyrics as an .lrc file (a download; the phone app asks where to put it) and says so. Returns the file name, or null when it failed (the message is shown). */
export async function exportLyricsFile(songId: number): Promise<string | null> {
  try {
    const { name, bytes } = await api.exportLrc(songId);
    await saveFile(name, "application/octet-stream", bytes);
    notify({ kind: "ok", text: en.timing.exported(name) });
    return name;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null; // the picker was closed
    notify({ kind: "error", text: e instanceof ApiError ? e.message : en.errors.generic });
    return null;
  }
}
