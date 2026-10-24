const MIN = 60, HOUR = 3600, DAY = 86400;

const one = (n: number) => (Math.round(n * 10) / 10).toString();

/** The time a review button promises, as short as the button can hold: "1 min", "10 min", "1 d", "2.5 d", "4 mo". */
export function formatInterval(seconds: number): string {
  if (seconds < MIN) return "< 1 min";
  if (seconds < HOUR) return `${Math.round(seconds / MIN)} min`;
  if (seconds < DAY) return `${Math.round(seconds / HOUR)} h`;
  if (seconds < 30 * DAY) return `${one(seconds / DAY)} d`;
  if (seconds < 365 * DAY) return `${one(seconds / (30 * DAY))} mo`;
  return `${one(seconds / (365 * DAY))} y`;
}

/** "in 12 min" for the moment the next card is due. */
export function formatWait(ms: number): string {
  return ms <= 0 ? "now" : `in ${formatInterval(Math.max(MIN, Math.round(ms / 1000)))}`;
}

const MAX_INTERVAL = 365 * DAY;

/** What each review button would set for a card whose interval is now `current` seconds (the same rule as the server's). */
export function nextIntervals(current: number): Record<"again" | "hard" | "good" | "easy", number> {
  const small = current < DAY;
  const cap = (n: number) => Math.min(n, MAX_INTERVAL);
  return {
    again: MIN,
    hard: cap(small ? Math.max(10 * MIN, Math.floor(current * 1.5)) : Math.floor(current * 1.2)),
    good: cap(small ? DAY : Math.floor(current * 2.5)),
    easy: cap(small ? 4 * DAY : current * 4),
  };
}
