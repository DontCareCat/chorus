/**
 * The texts a blank's slot has to be able to hold: every answer option of its question, plus the word that is shown once it is answered
 * (always one of the options, listed anyway so the slot never depends on that). The slot is as wide as the widest of them in the line's own
 * font (components/Slot.tsx stacks them invisibly), so the blank has the width of the answer options, the answered line does not reflow,
 * and the blank gives no hint of the answer's length beyond what the options already show. Without options (none sent) the slot keeps a minimum width (styles.css).
 */
export function slotTexts(options: readonly { text: string }[], word?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...options.map((o) => o.text), ...(word ? [word] : [])]) {
    const s = t.trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}
