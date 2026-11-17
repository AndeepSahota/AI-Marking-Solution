"""Remove cell headings the model dropped from a band's points but left in
its descriptor text.

The extraction rules ask for headings that only group criteria ("Content",
"Organisation", "Technical accuracy") to be left out of both ``descriptor``
and ``descriptors``. On AQA writing grids the model often removes them from
the points only, so the word-for-word content check fails and the whole
writing question was skipped. When the ONLY difference is such headings,
they are removed from the descriptor text too -- deterministically, word for
word, so the descriptor IDs built from it carry no heading points.

Strict on purpose: every extra run must be 1-4 words, start with a capital
letter and contain no sentence punctuation. A dropped sentence, a changed
word or a reordering is left alone, and the content check still fails it.
"""

import copy
import difflib
import re
from typing import Any

from validation.band_levels import is_points_objective

_WORD = re.compile(r"[A-Za-z0-9][\w'’-]*")
_MAX_HEADING_WORDS = 4


def _words(text: str) -> list[re.Match]:
    return list(_WORD.finditer(text or ""))


def _heading_spans(descriptor: str, points: list[str]) -> list[tuple[int, int]] | None:
    """Spans of descriptor text to remove, or None if the differences are
    not all dropped headings."""
    source = _words(descriptor)
    model = [m.group(0).casefold() for m in _words(" ".join(points))]
    spans = []
    matcher = difflib.SequenceMatcher(None, [m.group(0).casefold() for m in source], model, autojunk=False)
    for tag, i1, i2, _, _ in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag != "delete" or i2 - i1 > _MAX_HEADING_WORDS:
            return None
        start, end = source[i1].start(), source[i2 - 1].end()
        if not source[i1].group(0)[0].isupper() or re.search(r"[.!?;]", descriptor[start:end]):
            return None
        if end < len(descriptor) and descriptor[end] == ":":
            end += 1
        spans.append((start, end))
    return spans or None


def remove_dropped_headings(question: dict[str, Any]) -> dict[str, Any]:
    """A copy of the question with dropped headings removed from each band's
    descriptor text; bands with any other difference are left unchanged."""
    question = copy.deepcopy(question)
    for objective in question.get("assessment_objectives") or []:
        if is_points_objective(objective):
            continue
        for band in objective.get("bands") or []:
            descriptor, points = band.get("descriptor"), band.get("descriptors")
            if not isinstance(descriptor, str) or not isinstance(points, list) or not all(isinstance(p, str) for p in points):
                continue
            spans = _heading_spans(descriptor, points)
            if not spans:
                continue
            for start, end in reversed(spans):
                descriptor = descriptor[:start] + " " + descriptor[end:]
            band["descriptor"] = re.sub(r"[ \t]{2,}", " ", descriptor).strip()
    return question
