import { useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { api, ApiError } from "../services/api";
import type { DictEntryDto } from "../services/api";
import { Dialog } from "./Dialog";
import { LanguageSelect } from "./LanguageSelect";
import { Select } from "./Select";

const POS = Object.keys(en.wordCard.pos);

/**
 * "+ Add word" (a word, its language and optionally a meaning and an example sentence) and, with `entry`, the edit of a word's meaning, lemma,
 * article and type. A meaning written here is kept: a later look-up asks before it replaces it.
 */
export function WordEditor({ entry, defaultLanguage, onClose, onSaved }: { entry?: DictEntryDto; defaultLanguage: string; onClose: () => void; onSaved: () => void }) {
  const t = en.dictionary.editor;
  const [word, setWord] = useState("");
  const [language, setLanguage] = useState(defaultLanguage);
  const [meaning, setMeaning] = useState(entry?.translation ?? "");
  const [example, setExample] = useState("");
  const [lemma, setLemma] = useState(entry?.lemma ?? "");
  const [article, setArticle] = useState(entry?.article ?? "");
  const [pos, setPos] = useState(entry?.pos ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (entry) {
        await api.editWord(entry.id, { translation: meaning, lemma, article, pos });
      } else {
        await api.addWord({ language, word: word.trim(), source: "manual", ...(meaning.trim() ? { translation: meaning.trim() } : {}), ...(example.trim() ? { example: example.trim() } : {}) });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Dialog title={entry ? t.editTitle : t.addTitle} onClose={onClose}>
      <form className="exchange" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (!busy && (entry || word.trim())) void save(); }}>
        {!entry && (
          <>
            <label className="field"><span>{t.word}</span><input type="text" {...noAutofill("word-editor-word")} value={word} onChange={(e) => setWord(e.target.value)} maxLength={100} autoFocus /></label>
            <label className="field"><span>{t.language}</span><LanguageSelect id="editor-language" value={language} onChange={setLanguage} /></label>
          </>
        )}
        <label className="field"><span>{t.meaning}</span><input type="text" {...noAutofill("word-editor-meaning")} value={meaning} onChange={(e) => setMeaning(e.target.value)} maxLength={300} placeholder={entry ? undefined : t.meaningOptional} /></label>
        {entry ? (
          <>
            <label className="field"><span>{t.lemma}</span><input type="text" {...noAutofill("word-editor-lemma")} value={lemma} onChange={(e) => setLemma(e.target.value)} maxLength={100} /></label>
            <label className="field"><span>{t.article}</span><input type="text" {...noAutofill("word-editor-article")} value={article} onChange={(e) => setArticle(e.target.value)} maxLength={16} /></label>
            <label className="field"><span>{t.pos}</span>
              <Select value={pos} onChange={setPos} options={[{ value: "", label: t.noPos }, ...POS.map((p) => ({ value: p, label: en.wordCard.pos[p]! }))]} />
            </label>
          </>
        ) : (
          <label className="field"><span>{t.example}</span><input type="text" {...noAutofill("word-editor-example")} value={example} onChange={(e) => setExample(e.target.value)} maxLength={1000} placeholder={t.exampleOptional} /><small>{t.lookupFills}</small></label>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn secondary" onClick={onClose}>{en.confirm.cancel}</button>
          <button type="submit" className="btn inverse" disabled={busy || (!entry && !word.trim())}>{busy ? t.saving : entry ? t.save : t.add}</button>
        </div>
      </form>
    </Dialog>
  );
}
