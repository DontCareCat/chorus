/**
 * The texts a blank's slot has to be able to hold: every answer option of its question, plus the word that is shown once it is answered
 * (always one of the options, listed anyway so the slot never depends on that). The slot is as wide as the widest of them in the line's own
 * font (components/Slot.tsx stacks them invisibly), so the blank has the width of the answer options, the answered line does not reflow,
 * and the blank gives no hint of the answer's length beyond what the options already show. Typing games send no options (the word is not known until it is answered): their slots reserve TYPING_SLOT.
 */
export const TYPING_SLOT = "m".repeat(12);

export function slotTexts(options: readonly { text: string }[], word?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // typing mode has no options and the asked word is not known before it is answered: a fixed room of 12 letters (a longer word widens it)
  for (const t of [...(options.length ? options.map((o) => o.text) : [TYPING_SLOT]), ...(word ? [word] : [])]) {
    const s = t.trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}
