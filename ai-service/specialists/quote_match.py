"""Check a specialist's quote against the student response.

Forgives only copying slips that don't change what was written: letter case,
runs of whitespace, curly vs straight quotation marks and apostrophes, and
punctuation at the very start or end of the quote. A changed, added or
missing word still fails. Real case this fixes: the essay said "Furthermore,
the quotation ..." and the specialist copied "The quotation ...", because
three other sentences in the same essay began that way -- the exact-match
check rejected it and stalled a 15/15 answer at Level 1 on that thread.
"""

import difflib
import re
import string

_QUOTE_CHARS = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
}
_EDGE_CHARS = string.punctuation + string.whitespace
_DELIMITER = re.compile(r"<<<(?:END_)?MARK_SCHEME_OCR_[^>]*>>>")


def _normalise_with_map(text: str) -> tuple[str, list[int]]:
    """Normalised text, plus for each normalised character the index of the
    original character it came from -- so a match can be mapped back to the
    student's own words."""
    out, index_map = [], []
    previous_space = False
    for i, ch in enumerate(text):
        if ch.isspace():
            if not previous_space:
                out.append(" ")
                index_map.append(i)
            previous_space = True
            continue
        previous_space = False
        for lowered in _QUOTE_CHARS.get(ch, ch).lower():
            out.append(lowered)
            index_map.append(i)
    return "".join(out), index_map


def _normalise_quote(quote: str) -> str:
    return _normalise_with_map(quote)[0].strip(_EDGE_CHARS)


def find_quote(quote: str | None, response: str) -> str | None:
    """The matching span of the response, in the student's own text, or None
    if the quote isn't in it."""
    if not quote or not any(ch.isalnum() for ch in quote):
        return None
    if quote in response:
        return quote
    needle = _normalise_quote(quote)
    if not needle:
        return None
    haystack, index_map = _normalise_with_map(response)
    start = haystack.find(needle)
    if start == -1:
        return None
    end = start + len(needle) - 1
    return response[index_map[start]:index_map[end] + 1]


def closest_text(quote: str | None, response: str) -> tuple[str, float]:
    """The run of words in the response most similar to a quote that failed,
    and how similar it is (0-1) -- for the log, so a near-miss can be told
    apart from an invented quote."""
    if not quote:
        return "", 0.0
    words = _DELIMITER.sub(" ", response).split()
    needle = _normalise_quote(quote)
    target = len(quote.split())
    best, best_ratio = "", 0.0
    for size in {max(1, target - 1), target, target + 1}:
        for i in range(0, max(1, len(words) - size + 1)):
            window = " ".join(words[i:i + size])
            ratio = difflib.SequenceMatcher(None, needle, _normalise_quote(window)).ratio()
            if ratio > best_ratio:
                best, best_ratio = window, ratio
    return best, best_ratio
