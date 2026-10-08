import { describe, expect, it } from "vitest";
import { buildQuiz, answeredIds, syncQuestions } from "./state";
import { getEarliestUnanswered, getRecoveryPosition, isOverdue, limitSeek, updateSynchronization } from "./synchronization";
import type { SyncQuestion } from "./synchronization";
import { toAudioTime } from "./timing";
import type { GameDto, QuestionDto } from "../types/game";

const q = (id: number, start: number, end: number, recovery = start): SyncQuestion => ({
  id, sequence: id, startTime: start, endTime: end, recoveryTime: recovery,
});
const none = new Set<number>();

describe("3-second rule", () => {
  const q19 = q(19, 49.0, 52.1, 45.3);
  it("normal playback: no recovery", () => {
    expect(updateSynchronization({ currentTime: 50, questions: [q(1, 40, 52)], answered: none }).kind).toBe("ok");
  });
  it("exactly 3 s ahead: no recovery (strict >)", () => {
    expect(updateSynchronization({ currentTime: 55, questions: [q(1, 40, 52)], answered: none }).kind).toBe("ok");
    expect(isOverdue(55, q(1, 40, 52))).toBe(false);
  });
  it("more than 3 s ahead: recovery", () => {
    expect(updateSynchronization({ currentTime: 55.01, questions: [q(1, 40, 52)], answered: none }).kind).toBe("recover");
  });
  it("spec example: 55.2 > 52.1 + 3 → seek to the previous line (45.3), not 49.1", () => {
    const d = updateSynchronization({ currentTime: 55.2, questions: [q19], answered: none });
    expect(d).toEqual({ kind: "recover", question: q19, target: 45.3 });
  });
  it("is overdue only after the audio is past the question, never before", () => {
    expect(isOverdue(10, q19)).toBe(false);
    expect(isOverdue(0, q19)).toBe(false);
  });
});

describe("which question blocks", () => {
  it("an answered question never blocks", () => {
    expect(updateSynchronization({ currentTime: 100, questions: [q(1, 10, 12)], answered: new Set([1]) }).kind).toBe("ok");
  });
  it("no questions at all: ok", () => {
    expect(updateSynchronization({ currentTime: 100, questions: [], answered: none }).kind).toBe("ok");
  });
  it("earliest unanswered determines synchronization, regardless of list order", () => {
    const qs = [q(4, 70, 73), q(2, 30, 33), q(3, 50, 53), q(1, 10, 13)];
    expect(getEarliestUnanswered(qs, new Set([1]))?.id).toBe(2);
    expect(getEarliestUnanswered(qs, new Set([1, 2]))?.id).toBe(3);
    // Q2 unanswered and overdue although Q3/Q4 are not
    const d = updateSynchronization({ currentTime: 40, questions: qs, answered: new Set([1]) });
    expect(d.kind === "recover" && d.question.id).toBe(2);
  });
  it("a far-ahead unanswered question does not block while an earlier one is fine", () => {
    expect(updateSynchronization({ currentTime: 20, questions: [q(1, 10, 25), q(2, 100, 110)], answered: none }).kind).toBe("ok");
  });
});

describe("recovery position", () => {
  it("uses the previous lyric line's start", () => {
    expect(getRecoveryPosition(q(2, 49, 52, 45.3))).toBe(45.3);
  });
  it("first question: its own start", () => {
    expect(getRecoveryPosition(q(1, 12, 15, 12))).toBe(12);
    expect(getRecoveryPosition({ ...q(1, 12, 15), recoveryTime: NaN })).toBe(12);
  });
});

describe("end of audio", () => {
  it("recovers when audio ended with an unanswered question, even if the grace period never elapsed", () => {
    const question = q(1, 100, 118); // duration 120 < 118 + 3: the rule can never fire
    expect(updateSynchronization({ currentTime: 120, questions: [question], answered: none }).kind).toBe("ok");
    expect(updateSynchronization({ currentTime: 120, ended: true, questions: [question], answered: none }).kind).toBe("recover");
  });
  it("ended with everything answered: ok", () => {
    expect(updateSynchronization({ currentTime: 120, ended: true, questions: [q(1, 1, 2)], answered: new Set([1]) }).kind).toBe("ok");
  });
});

describe("offset", () => {
  const dto = (offset: number, qs: Partial<QuestionDto>[]): GameDto => ({
    public_id: "x", song_id: 1, song_title: "t", song_artist: "a", song_duration: 100, sample_rate: 44100, language: "de", difficulty: "easy", synced: true, lyrics_offset: offset,
    started_at: "", finished_at: null, progress: { answered: 0, total: qs.length, score: 0, correct: 0, streak: 0, multiplier: 1, best_multiplier: 1 },
    lines: [],
    questions: qs.map((p, i) => ({
      id: i + 1, line_id: i + 1, blank_index: 0, sequence: i, audio_start: 10, audio_end: 12, recovery_start: 5,
      question_text: "a ____", text: null, options: [], answer: null, ...p,
    })),
  });
  it("is applied exactly once to every time field", () => {
    const [x] = buildQuiz(dto(0.5, [{}]));
    expect([x!.startTime, x!.endTime, x!.recoveryTime]).toEqual([10.5, 12.5, 5.5]);
    expect(toAudioTime(1, -5)).toBe(0); // clamped
  });
  it("shifts the whole 3 s window with the lyrics", () => {
    const [sq] = syncQuestions(buildQuiz(dto(2, [{}])));
    expect(isOverdue(17, sq!)).toBe(false); // 12 + 2 + 3
    expect(isOverdue(17.01, sq!)).toBe(true);
  });
  it("unsynchronized lyrics produce no gating questions", () => {
    const quiz = buildQuiz(dto(0, [{ audio_start: null, audio_end: null, recovery_start: null }]));
    expect(syncQuestions(quiz)).toEqual([]);
  });
  it("answered ids come from the persisted answers and order follows sequence", () => {
    const quiz = buildQuiz(dto(0, [
      { sequence: 1, answer: { selected_option_id: 1, correct: true, correct_option_id: 1, answered_at: "" } },
      { sequence: 0 },
    ]));
    expect(quiz.map((x) => x.sequence)).toEqual([0, 1]);
    expect([...answeredIds(quiz)]).toEqual([1]);
  });
});


describe("limitSeek: an open question cannot be skipped", () => {
  const q19 = q(19, 49.0, 52.1, 45.3); // deadline 55.1
  const base = { questions: [q19], answered: none };
  it("allows everything up to the question's deadline (end + 3 s), and anything backwards", () => {
    expect(limitSeek({ ...base, requested: 20, current: 10 })).toEqual({ target: 20, clamped: false });
    expect(limitSeek({ ...base, requested: 55.1, current: 10 })).toEqual({ target: 55.1, clamped: false });
    expect(limitSeek({ ...base, requested: 3, current: 70 })).toEqual({ target: 3, clamped: false });
  });
  it("beyond the deadline: lands at the start of the open question's line when the audio is before it", () => {
    expect(limitSeek({ ...base, requested: 55.11, current: 10 })).toEqual({ target: 49, clamped: true });
    expect(limitSeek({ ...base, requested: 500, current: 10 })).toEqual({ target: 49, clamped: true });
  });
  it("…and stays where it is when the audio is already inside that line", () => {
    expect(limitSeek({ ...base, requested: 500, current: 50.4 })).toEqual({ target: 50.4, clamped: true });
  });
  it("never lands past the deadline even if the audio already is (it comes back to the limit)", () => {
    expect(limitSeek({ ...base, requested: 500, current: 90 })).toEqual({ target: 55.1, clamped: true });
  });
  it("is decided by the EARLIEST unanswered question, not a later one", () => {
    const later = q(20, 80, 84, 75);
    expect(limitSeek({ questions: [later, q19], answered: none, requested: 90, current: 10 })).toEqual({ target: 49, clamped: true });
    expect(limitSeek({ questions: [later, q19], answered: new Set([19]), requested: 90, current: 10 })).toEqual({ target: 80, clamped: true }); // Q19 answered: now Q20 (starts 80) is the open one
  });
  it("answered questions never limit; nor does an empty quiz (free play)", () => {
    expect(limitSeek({ questions: [q19], answered: new Set([19]), requested: 500, current: 10 })).toEqual({ target: 500, clamped: false });
    expect(limitSeek({ questions: [], answered: none, requested: 500, current: 10 })).toEqual({ target: 500, clamped: false });
  });
});
