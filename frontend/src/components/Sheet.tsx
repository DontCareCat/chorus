import { groupByLine, buildPrompt } from "../game/prompt";
import { en } from "../i18n/en";
import type { QuestionResult } from "../hooks/useGame";
import type { QuizQuestion } from "../types/question";
import { rightWord } from "./Question";

interface Props {
  quiz: readonly QuizQuestion[];
  results: ReadonlyMap<number, QuestionResult>;
  focusedId: number | null;
  onFocus: (id: number) => void;
}

/** One row per lyric line: open blanks stay hidden, answered ones are filled in, with ✓ / ✗ / ○ for the line. */
export function Sheet({ quiz, results, focusedId, onFocus }: Props) {
  return (
    <section aria-labelledby="sheet-title">
      <h3 className="sheet-title" id="sheet-title">{en.game.sheet}</h3>
      <ul className="sheet">
        {groupByLine(quiz).map((g) => {
          const first = g.questions[0]!;
          const rs = g.questions.map((q) => results.get(q.id));
          const open = g.questions.filter((q) => !results.has(q.id));
          // a line is "open" until every blank of it is answered; then ✗ if any was wrong, else ✓
          const kind = open.length > 0 ? "open" : rs.some((r) => r?.correct === false) ? "wrong" : "correct";
          const parts = buildPrompt(first, g.questions, (s) => rightWord(s, results.get(s.id)));
          const target = open[0] ?? first;
          const focused = g.questions.some((q) => q.id === focusedId);
          return (
            <li key={g.lineId}>
              <button type="button" className="sheet-line" data-qid={target.id} data-r={kind} aria-current={focused} onClick={() => onFocus(target.id)}>
                <span className="mark" aria-label={kind === "correct" ? "correct" : kind === "wrong" ? "wrong" : "open"}>
                  {kind === "correct" ? "✓" : kind === "wrong" ? "✗" : "○"}
                </span>
                <span>
                  {parts.map((p, i) =>
                    p.kind === "text" ? (
                      <span key={i}>{p.text}</span>
                    ) : p.state === "active" ? (
                      // in the sheet there is no "active" blank: every blank shows its own state
                      <span key={i}>{blankWord(g.questions, p.index, results)}</span>
                    ) : p.state === "filled" ? (
                      <span key={i} className="em">{p.word}</span>
                    ) : (
                      <span key={i}>{"____"}</span>
                    ),
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function blankWord(qs: readonly QuizQuestion[], index: number, results: ReadonlyMap<number, QuestionResult>) {
  const q = qs.find((x) => x.blankIndex === index);
  const w = q ? rightWord(q, results.get(q.id)) : undefined;
  return w ? <span className="em">{w}</span> : "____";
}
