"""Accept a band whose points are all copied word for word from the scheme.

The content check compares a band's ``descriptor`` (the model's transcription)
with its ``descriptors`` (the model's points). On multi-column writing grids
the model puts a level title ("Consistent, Clear Communication") or a column
header ("The candidate:") in ``descriptor`` and the real criteria in the
points, every time -- so all 5 writing questions in the hold-out run were
skipped although every point was exact. What matters is that nothing is
invented or changed, so the points are checked against the scheme's own OCR
text instead. When that is how a band passes, its descriptor is rebuilt from
the points, so descriptor IDs and the marking engine only ever see criteria;
the model's original text is kept as ``band_title``.
"""

import copy
import html
import re
import unicodedata
from typing import Any

from validation.band_levels import is_points_objective

_TAG = re.compile(r"<[^>]+>")
_MARKERS = re.compile(r"[•▪◦●○*]")
_MIN_POINT_WORDS = 3  # a short fragment could match anywhere by chance


def _key(text: str) -> str:
    """Text reduced to its words: no tags, bullets, case or whitespace."""
    text = unicodedata.normalize("NFKC", html.unescape(_TAG.sub(" ", text or "")))
    text = _MARKERS.sub(" ", text).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return "".join(text.split()).casefold()


def points_in_source(points: list, source_key: str) -> bool:
    if not points or not all(isinstance(p, str) for p in points):
        return False
    return all(len(p.split()) >= _MIN_POINT_WORDS and _key(p) in source_key for p in points)


def anchor_bands_to_source(question: dict[str, Any], failing_bands: set, source_text: str) -> dict[str, Any] | None:
    """A copy of the question with each failing band's descriptor rebuilt
    from its points, if every point of every failing band appears word for
    word in the source text; otherwise None. failing_bands: {(ao, band)}."""
    if not source_text:
        return None
    source_key = _key(source_text)
    question = copy.deepcopy(question)
    for objective in question.get("assessment_objectives") or []:
        if is_points_objective(objective):
            continue
        for band in objective.get("bands") or []:
            if (objective.get("ao"), band.get("band")) not in failing_bands:
                continue
            points = band.get("descriptors")
            if not points_in_source(points, source_key):
                return None
            original = band.get("descriptor")
            if isinstance(original, str) and original.strip():
                band["band_title"] = original.strip()
            band["descriptor"] = " ".join(f"• {p.strip()}" for p in points)
    return question
