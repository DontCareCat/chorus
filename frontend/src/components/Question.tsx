import { memo, useEffect, useRef, useState } from "react";
import { noAutofill } from "../lib/noAutofill";
import type { FormEvent } from "react";
import { buildPrompt } from "../game/prompt";
import { useFitText } from "../hooks/useFitText";
import { resultWord, rightWord } from "../game/results";
import type { QuestionResult } from "../game/results";
import { en } from "../i18n/en";
import type { QuizQuestion } from "../types/question";

const KEYS = ["1", "2", "3", "4"];

interface Props {
  question: QuizQuestion;
  /** All questions of the same lyric line (including this one). */
  siblings: readonly QuizQuestion[];
  results: ReadonlyMap<number, QuestionResult>;
  index: number;
  total: number;
  onAnswer: (optionId: number) => void;
  /** Phone layout: no big sentence (the lyric window carries the line); only the answers. */
  answersOnly?: boolean;
  /** Typing mode: a text field instead of four options. */
  typing?: boolean;
  onSubmit?: (text: string) => void;
}

export const Question = memo(function Question({ question: q, siblings, results, index, total, onAnswer, answersOnly = false, typing = false, onSubmit }: Props) {
  const result = results.get(q.id);
  const shown = resultWord(q, result);
  const state = shown
    ? shown.ok === undefined ? "pending" : shown.match === "partial" ? "partial" : shown.ok ? "correct" : "wrong"
    : "open";
  // multiple choice shows the (wrong) word that was picked; typing always shows the word that was asked
  const wrongWord = !typing && result && result.correct === false ? q.options.find((o) => o.id === result.selectedOptionId)?.text : undefined;
  const parts = buildPrompt(q, siblings, (s) => rightWord(s, results.get(s.id)));
  const blanksInLine = siblings.length;
  const promptRef = useFitText<HTMLHeadingElement>(JSON.stringify([q.id, state, wrongWord, shown?.word, parts]));
  const reveal = shown?.ok === true ? en.game.correct : shown?.match === "partial" ? en.game.almost(shown.word) : shown?.ok === false ? en.game.wrong(shown.word) : "";

  return (
    <section className="prompt-wrap" aria-labelledby={answersOnly ? undefined : "prompt"} aria-label={answersOnly ? "Answers" : undefined}>
      {!answersOnly && (
        <>
          <div className="prompt-bar">
            <p className="prompt-count">
              {en.game.question(index + 1, total)}
              {blanksInLine > 1 && ` · ${en.game.blankOf(q.blankIndex + 1, blanksInLine)}`}
            </p>
          </div>
          <h2 className="prompt" id="prompt" ref={promptRef}>
            {parts.map((p, i) => {
              if (p.kind === "text") return <span key={i}>{p.text}</span>;
              if (p.state === "active") {
                return (
                  <span key={i} className="blank" data-state={state} data-active="true">
                    {state === "wrong" && !typing ? wrongWord : (shown?.word ?? " ")}
                  </span>
                );
              }
              return (
                <span key={i} className="blank" data-state={p.state === "filled" ? "filled" : "sibling"}>
                  {p.state === "filled" ? p.word : " "}
                </span>
              );
            })}
          </h2>
          <p className="reveal" data-ok={shown?.match === "partial" ? "partial" : shown?.ok} aria-live="polite">{reveal}</p>
        </>
      )}
      {typing ? (
        <TypedAnswer key={q.id} result={result} state={state} reveal={answersOnly ? reveal : ""} onSubmit={(t) => onSubmit?.(t)} />
      ) : (
        <ul className="options" aria-label="Answers">
          {q.options.map((o, i) => {
            let s: string | undefined;
            if (result) {
              if (result.correct === undefined) s = o.id === result.selectedOptionId ? undefined : "dim";
              else if (o.id === result.correctOptionId) s = "correct";
              else if (o.id === result.selectedOptionId) s = "wrong";
              else s = "dim";
            }
            return (
              <li key={o.id}>
                <button type="button" className="opt" data-state={s} disabled={!!result} onClick={() => onAnswer(o.id)}>
                  <span className="opt-key" aria-hidden="true">{KEYS[i]}</span>
                  <span>{o.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});

/** The typing mode's answer box: one field and a Check button; Enter submits. It takes the focus for each new question. */
function TypedAnswer({ result, state, reveal, onSubmit }: { result: QuestionResult | undefined; state: string; reveal: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!result) input.current?.focus(); }, [result]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!result && text.trim()) onSubmit(text.trim());
  };
  return (
    <form className="typing" data-state={state} onSubmit={submit} autoComplete="off">
      <input
        ref={input} type="text" value={result ? (result.typed ?? "") : text} onChange={(e) => setText(e.target.value)} disabled={!!result}
        placeholder={en.game.typeHere} aria-label={en.game.typeLabel} {...noAutofill("word-answer")} inputMode="text" enterKeyHint="send" maxLength={100}
      />
      {reveal && <span className="typing-result" role="status">{reveal}</span>}
      <button type="submit" className="btn" disabled={!!result || !text.trim()}>{en.game.check}</button>
    </form>
  );
}
