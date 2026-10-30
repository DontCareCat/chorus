import { useRef, useState } from "react";
import { en } from "../i18n/en";
import { saveFile } from "../lib/save-file";
import { api, ApiError } from "../services/api";
import type { DictStatus } from "../services/api";
import { Dialog } from "./Dialog";
import { LanguageSelect } from "./LanguageSelect";

interface Scope { status: DictStatus; language?: string; q?: string }

/** Export the words the Dictionary page shows as an Anki deck or a plain-text list, or import a deck or a list. */
export function DictionaryExchange({ mode, scope, shown, defaultLanguage, onClose, onImported }: {
  mode: "export" | "import"; scope: Scope; shown: number; defaultLanguage: string; onClose: () => void; onImported: () => void;
}) {
  const [format, setFormat] = useState<"apkg" | "txt">("apkg");
  const [schedule, setSchedule] = useState(true);
  const [language, setLanguage] = useState(defaultLanguage);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const t = en.dictionary.exchange;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (mode === "export") {
        const out = await api.exportDictionary({ format, schedule: schedule && format === "apkg", ...scope });
        await saveFile(out.filename, out.mime, out.bytes);
        setResult({ kind: "ok", text: t.exported(shown, out.filename) });
      } else if (file) {
        const r = await api.importDeck(file, language, schedule);
        setResult({ kind: "ok", text: t.imported(r.added, r.existing, r.skipped) });
        onImported();
      }
    } catch (e) {
      setResult({ kind: "error", text: e instanceof ApiError ? e.message : en.errors.generic });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={mode === "export" ? t.exportTitle : t.importTitle} onClose={onClose} describedBy="exchange-help">
      <div className="exchange">
        <p className="muted" id="exchange-help">{mode === "export" ? t.exportHelp(shown) : t.importHelp}</p>
        {mode === "export" ? (
          <>
            <div className="segmented" role="group" aria-label={t.format}>
              <button type="button" aria-pressed={format === "apkg"} onClick={() => setFormat("apkg")}>{t.apkg}</button>
              <button type="button" aria-pressed={format === "txt"} onClick={() => setFormat("txt")}>{t.txt}</button>
            </div>
            {format === "apkg" && (
              <label className="check"><input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} /><span>{t.withProgress}<small>{t.withProgressHelp}</small></span></label>
            )}
          </>
        ) : (
          <>
            <div className="inline">
              <button type="button" className="btn secondary" onClick={() => input.current?.click()}>{file ? t.otherFile : t.chooseFile}</button>
              <span className="muted exchange-file">{file?.name ?? t.noFile}</span>
              <input ref={input} type="file" accept=".apkg,.txt,.csv,.tsv,text/*" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
            </div>
            <label className="field"><span>{t.language}</span><LanguageSelect id="exchange-language" value={language} onChange={setLanguage} /></label>
            {file?.name.toLowerCase().endsWith(".apkg") && (
              <label className="check"><input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} /><span>{t.takeProgress}<small>{t.takeProgressHelp}</small></span></label>
            )}
          </>
        )}
        {result && <p className={`notice ${result.kind}`} role="status">{result.text}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn secondary" onClick={onClose}>{t.close}</button>
          <button type="button" className="btn inverse" disabled={busy || (mode === "import" && !file) || (mode === "export" && shown === 0)} onClick={() => void run()}>
            {busy ? t.working : mode === "export" ? t.export : t.import}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
