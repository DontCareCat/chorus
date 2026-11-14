import { BLANK } from "./prompt";
import { rightWord } from "./results";
import type { QuestionResult } from "./results";
import { slotTexts } from "./slot";
import type { QuizQuestion } from "../types/question";

/** A piece of a lyric line as the lyric window shows it. */
export type WindowPart =
  | { kind: "text"; text: string }
  | { kind: "blank"; index: number; focused: boolean; sizes: string[] }
  /** An answered blank: the RIGHT word is always shown; `state` says how the player did. Until the server has judged an answer the blank stays empty. */
  | { kind: "word"; index: number; word: string; state: "correct" | "partial" | "wrong"; focused: boolean; sizes: string[] };

export interface WindowLine {
  lineId: number;
  /** The whole line as it is sung (a tapped word is looked up with it). */
  text: string;
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

/** A line with blanks as the card quotes it: the answered words in place, an open blank as "…" (the answer is not given away). */
export const lineText = (parts: readonly WindowPart[]): string =>
  parts.map((p) => (p.kind === "text" ? p.text : p.kind === "blank" ? "…" : p.word)).join("").replace(/\s+/g, " ").trim();

/** Text with letters outside the bundled font's subsets (Latin, Latin Extended, Vietnamese): the system fallback font draws them, and its widths differ per weight. */
export const needsWeightLock = (text: string): boolean => /[^\u0000-\u02AF\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20C0]/.test(text);

/** The words of a piece of text, with where each starts, for tapping (letters, with an apostrophe or hyphen inside: geh'n, e-mail). */
export function wordSpans(text: string): { text: string; word: boolean }[] {
  const out: { text: string; word: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), word: false });
    out.push({ text: m[0], word: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), word: false });
  return out;
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
    if (!qs) return { lineId: l.line_id, text: l.text ?? "", startTime, parts: [{ kind: "text", text: l.text ?? "" }], targetId: null, status: "plain" };
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
      if (q && r && word !== undefined) parts.push({ kind: "word", index: i, word, state: r.match === "partial" ? "partial" : r.correct ? "correct" : "wrong", focused, sizes: slotTexts(q.options, word) });
      // an answer the server has not judged yet stays an empty blank: showing the chosen word in the plain colour first would flash and then change to the right word and colour
      else parts.push({ kind: "blank", index: i, focused, sizes: slotTexts(q?.options ?? []) });
    });
    const open = qs.filter((q) => !results.has(q.id));
    const wrong = qs.some((q) => results.get(q.id)?.correct === false);
    return {
      lineId: l.line_id, text: lineText(parts), startTime, parts, targetId: (open[0] ?? qs[0]!).id,
      status: open.length > 0 ? "open" : wrong ? "wrong" : "correct",
    };
  });
}

const samePart = (a: WindowPart, b: WindowPart): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "text") return a.text === (b as typeof a).text;
  const o = b as typeof a;
  if (a.index !== o.index || a.focused !== o.focused) return false;
  return a.kind === "blank" || (a.word === (o as typeof a).word && a.state === (o as typeof a).state);
};

const sameLine = (a: WindowLine, b: WindowLine): boolean =>
  a.lineId === b.lineId && a.text === b.text && a.startTime === b.startTime && a.targetId === b.targetId && a.status === b.status && a.parts.length === b.parts.length && a.parts.every((p, i) => samePart(p, b.parts[i]!));

/**
 * After an answer only one or two lines of the window change, but `buildWindowLines` makes new objects for all of them. This hands back the
 * previous object for every line that is unchanged (and the previous array when nothing changed), so React can skip the lines it already drew.
 */
export function reuseLines(prev: readonly WindowLine[] | null, next: WindowLine[]): WindowLine[] {
  if (!prev) return next;
  const merged = next.map((l, i) => (prev[i] && sameLine(prev[i]!, l) ? prev[i]! : l));
  return merged.length === prev.length && merged.every((l, i) => l === prev[i]) ? (prev as WindowLine[]) : merged;
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
 * The line the lyric window follows: the song's own line, except while the player answers AHEAD of the song (`ahead`: the last answer
 * was for a line the song had not reached). Then it is the line of the next question, until the song catches up with it.
 */
export const followLine = (current: number, focusedLine: number, ahead: boolean): number =>
  ahead && focusedLine > current ? focusedLine : current;

/** What the lyric window keeps in the middle: the line of the next open question (the window then moves once per answer), or the line the song sings. */
export type LyricFocus = "question" | "line";

/**
 * The line the window centres on for a focus mode. "question": the question being answered while one is open (`asked`), else the song's line.
 * "line": the song's own line, except while answering ahead of it (`followLine`).
 */
export const focusLine = (mode: LyricFocus, current: number, focusedLine: number, asked: boolean, ahead: boolean): number =>
  mode === "question" ? (asked && focusedLine >= 0 ? focusedLine : current) : followLine(current, focusedLine, ahead && asked);

export const timecode = (seconds: number | null): string => {
  if (seconds === null) return "";
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
