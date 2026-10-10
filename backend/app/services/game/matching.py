"""Judging a typed answer: full match, partial match, or wrong.

Both words are normalised first (case, accents, punctuation, spaces and hyphens do not matter). A word is then
- a **full** match when they are equal;
- a **partial** match when it is a small typo (1 edit for words of 3-5 letters, 2 edits for longer ones, a swapped pair
  of neighbouring letters counts as one edit), or the typed text is the first >= 60 % of the word (cut short), or the
  typed text is the word with something added after it (an ending, "geh" -> "gehst");
- otherwise wrong.
"""
import unicodedata

PREFIX_SHARE = 0.6
MIN_PARTIAL_LEN = 3


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    letters = (c for c in decomposed if not unicodedata.combining(c) and c.isalnum())
    return "".join(letters).casefold()


def edit_distance(a: str, b: str) -> int:
    """Optimal string alignment distance: insertions, deletions, substitutions and swapped neighbours cost 1."""
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[len(b)]


def typo_limit(length: int) -> int:
    return 0 if length < MIN_PARTIAL_LEN else 1 if length <= 5 else 2


def judge(typed: str, word: str) -> str:
    """'full', 'partial' or 'none'."""
    t, w = normalize(typed), normalize(word)
    if not t or not w:
        return "none"
    if t == w:
        return "full"
    limit = typo_limit(len(w))
    if limit and edit_distance(t, w) <= limit:
        return "partial"
    if len(w) >= MIN_PARTIAL_LEN:
        if len(t) >= MIN_PARTIAL_LEN and len(t) < len(w) and w.startswith(t) and len(t) >= PREFIX_SHARE * len(w):
            return "partial"  # cut short
        if len(t) > len(w) and t.startswith(w):
            return "partial"  # an ending added
    return "none"
