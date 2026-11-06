"""Check a specialist's quote against the student response.

Forgives only copying slips that don't change what was written: letter case,
runs of whitespace, curly vs straight quotation marks and apostrophes (also
when they arrive broken, as control characters), punctuation at the very
start or end of the quote, and words the student crossed out. A changed,
added or missing word still fails. Real cases this fixes:
- the essay said "Furthermore, the quotation ..." and the specialist copied
  "The quotation ...", because three other sentences in the same essay began
  that way -- the exact-match check stalled a 15/15 answer at Level 1;
- the essay said "the ~~word~~ phrase ..." (OCR marks crossed-out words with
  ~~) and the specialist quoted "the phrase ...", as a reader would -- the
  rejection dropped one essay from 9/15 to 3/15.
"""

import difflib
import re
import string

_QUOTE_CHARS = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
    # Curly quotes that lost their high byte on the way back from the model
    # (U+2018/2019/201C/201D arriving as U+0018/0019/001C/001D).
    "\x18": "'", "\x19": "'", "\x1c": '"', "\x1d": '"',
}
_EDGE_CHARS = string.punctuation + string.whitespace
_DELIMITER = re.compile(r"<<<(?:END_)?MARK_SCHEME_OCR_[^>]*>>>")


_STRUCK = "~~"

# How crossed-out text (~~like this~~) is read when matching: as written,
# left out (how a reader quotes it), or with the markers dropped but the
# words kept.
_AS_WRITTEN, _SKIP_STRUCK, _UNMARK_STRUCK = "as_written", "skip", "unmark"


def _normalise_with_map(text: str, struck: str = _AS_WRITTEN) -> tuple[str, list[int]]:
    """Normalised text, plus for each normalised character the index of the
    original character it came from -- so a match can be mapped back to the
    student's own words."""
    out, index_map = [], []
    previous_space = False
    inside_struck = False
    i = 0
    while i < len(text):
        if struck != _AS_WRITTEN and text.startswith(_STRUCK, i):
            inside_struck = not inside_struck
            i += len(_STRUCK)
            continue
        # Mapped before the whitespace test: Python counts the broken
        # quote characters (\x1c, \x1d) as whitespace.
        ch = _QUOTE_CHARS.get(text[i], text[i])
        i += 1
        if inside_struck and struck == _SKIP_STRUCK:
            continue
        if ch.isspace():
            if not previous_space:
                out.append(" ")
                index_map.append(i - 1)
            previous_space = True
            continue
        previous_space = False
        for lowered in ch.lower():
            out.append(lowered)
            index_map.append(i - 1)
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
    for struck in (_AS_WRITTEN, _SKIP_STRUCK, _UNMARK_STRUCK):
        haystack, index_map = _normalise_with_map(response, struck)
        start = haystack.find(needle)
        if start != -1:
            end = start + len(needle) - 1
            return response[index_map[start]:index_map[end] + 1]
    return None


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
