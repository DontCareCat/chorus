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
}

export function Question({ question: q, siblings, results, index, total, onAnswer, answersOnly = false }: Props) {
  const result = results.get(q.id);
  const shown = resultWord(q, result);
  const state = shown ? (shown.ok === undefined ? "pending" : shown.ok ? "correct" : "wrong") : "open";
  const wrongWord = result && result.correct === false ? q.options.find((o) => o.id === result.selectedOptionId)?.text : undefined;
  const parts = buildPrompt(q, siblings, (s) => rightWord(s, results.get(s.id)));
  const blanksInLine = siblings.length;
  const promptRef = useFitText<HTMLHeadingElement>();

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
                    {state === "wrong" ? wrongWord : (shown?.word ?? " ")}
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
          <p className="reveal" data-ok={shown?.ok} aria-live="polite">
            {shown?.ok === true && en.game.correct}
            {shown?.ok === false && en.game.wrong(shown.word)}
          </p>
        </>
      )}
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
    </section>
  );
}
