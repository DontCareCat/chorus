import { BLANK } from "./prompt";
import { rightWord } from "./results";
import type { QuestionResult } from "./results";
import type { QuizQuestion } from "../types/question";

/** A piece of a lyric line as the lyric window shows it. */
export type WindowPart =
  | { kind: "text"; text: string }
  | { kind: "blank"; index: number; focused: boolean }
  /** An answered blank: the RIGHT word is always shown; `state` says how the player did (pending = not confirmed yet). */
  | { kind: "word"; index: number; word: string; state: "correct" | "wrong" | "pending"; focused: boolean };

export interface WindowLine {
  lineId: number;
  /** Audio time the line starts (lyric time + offset); null for unsynchronized lyrics. */
  startTime: number | null;
  parts: WindowPart[];
  /** The question a click on the line focuses: its first open one, else its first. null for lines without questions. */
  targetId: number | null;
  /** "open" until every blank is answered, then "wrong" if any was wrong, else "correct"; "plain" has no blanks. */
  status: "plain" | "open" | "correct" | "wrong";
}

export interface LineInput {
  line_id: number;
  audio_start: number | null;
  text: string | null;
}

/** All lines of the game, in song order, with their blanks resolved against the answers given so far. */
export function buildWindowLines(
  lines: readonly LineInput[],
  quiz: readonly QuizQuestion[],
  results: ReadonlyMap<number, QuestionResult>,
  offset: number,
  focusedId: number | null,
): WindowLine[] {
  const byLine = new Map<number, QuizQuestion[]>();
  for (const q of quiz) byLine.set(q.lineId, [...(byLine.get(q.lineId) ?? []), q].sort((a, b) => a.blankIndex - b.blankIndex));
  return lines.map((l) => {
    const startTime = l.audio_start === null ? null : l.audio_start + offset;
    const qs = byLine.get(l.line_id);
    if (!qs) return { lineId: l.line_id, startTime, parts: [{ kind: "text", text: l.text ?? "" }], targetId: null, status: "plain" };
    const pieces = qs[0]!.questionText.split(BLANK);
    const byIndex = new Map(qs.map((q) => [q.blankIndex, q]));
    const parts: WindowPart[] = [];
    pieces.forEach((text, i) => {
      if (text) parts.push({ kind: "text", text });
      if (i === pieces.length - 1) return;
      const q = byIndex.get(i);
      const r = q ? results.get(q.id) : undefined;
      const focused = q?.id === focusedId;
      const word = q ? rightWord(q, r) : undefined;
      if (q && r && word !== undefined) parts.push({ kind: "word", index: i, word, state: r.correct ? "correct" : "wrong", focused });
      else if (q && r) parts.push({ kind: "word", index: i, word: q.options.find((o) => o.id === r.selectedOptionId)?.text ?? "", state: "pending", focused });
      else parts.push({ kind: "blank", index: i, focused });
    });
    const open = qs.filter((q) => !results.has(q.id));
    const wrong = qs.some((q) => results.get(q.id)?.correct === false);
    return {
      lineId: l.line_id, startTime, parts, targetId: (open[0] ?? qs[0]!).id,
      status: open.length > 0 ? "open" : wrong ? "wrong" : "correct",
    };
  });
}

/**
 * The line the song is at: the last one that has started. Before the first line it is the first one.
 * Without timing (free play) the window follows the focused question's line instead.
 */
export function currentLineIndex(lines: readonly WindowLine[], time: number, synced: boolean, focusedLineIndex: number): number {
  if (lines.length === 0) return -1;
  if (!synced) return Math.max(0, focusedLineIndex);
  let current = 0;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i]!.startTime;
    if (start !== null && start <= time) current = i;
    else if (start !== null) break;
  }
  return current;
}

/** Vertical shift (px) that centres the current line in a viewport of `viewportHeight`. */
export const centerOffset = (viewportHeight: number, lineTop: number, lineHeight: number): number =>
  Math.round(viewportHeight / 2 - (lineTop + lineHeight / 2));

/**
 * Keep the lyrics from scrolling past their own ends: near the start the first line sits at the top (not in the
 * middle of an empty window), near the end the last line sits at the bottom. A short song just stays at the top.
 */
export const clampShift = (shift: number, viewportHeight: number, trackHeight: number): number =>
  Math.max(Math.min(0, viewportHeight - trackHeight), Math.min(0, shift));

export const timecode = (seconds: number | null): string => {
  if (seconds === null) return "";
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
