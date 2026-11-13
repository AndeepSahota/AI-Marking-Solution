"""Whether a mark scheme objective is a level scale or a points section.

One rule for the whole mark scheme step (descriptor checks, descriptor IDs,
the specialist router; the backend's review screens use the level-label part,
backend/src/services/reviewService.js levelsFor): a level scale has at least
two bands and every band is labelled like a level -- "Level 3", "Band 2" or a
bare number such as a "0" band -- or, failing that, every band has a mark
range and a real name (AQA's "High / Intermediate / Threshold performance"),
in which case levels are numbered by marks. Anything else is a points
section: lists of acceptable answers, "1 mark"/"2 marks" rows, true/false
statements, indicative content, or a "General" placeholder. The extraction prompt asks for those as ao "General",
but the model often names a real AO instead ("AO1" with a "General" band), so
the decision is made from the bands, not the AO label.
"""

import re

_LEVEL_LABEL = re.compile(r"^\s*(?:(?:level|band)\s*)?(\d+)\s*$", re.IGNORECASE)
# Words that mark a band label as a points row, never a named level.
_POINTS_WORDS = re.compile(r"\b(marks?|general|indicative|example|accept|answers?|points?|value not found)\b", re.IGNORECASE)


def level_number(label: object) -> int | None:
    """3 for "Level 3", "Band 3" or "3"; None for anything else."""
    match = _LEVEL_LABEL.match(label) if isinstance(label, str) else None
    return int(match.group(1)) if match else None


def mark_range(marks: object) -> tuple[int, int] | None:
    """(low, high) from "19-24", "2–3 marks", "4 marks" or 4; None otherwise."""
    numbers = [int(n) for n in re.findall(r"\d+", str(marks))] if marks is not None else []
    return (min(numbers), max(numbers)) if numbers else None


def level_numbers(bands: object) -> list[int] | None:
    """The level number of each band, in the bands' own order, or None if
    they are not a level scale. Level-labelled bands keep their own numbers;
    named bands with non-overlapping mark ranges are numbered by marks,
    lowest first, with a 0-mark band as level 0."""
    if not isinstance(bands, list) or len(bands) < 2 or not all(isinstance(b, dict) for b in bands):
        return None
    numbers = [level_number(band.get("band")) for band in bands]
    if all(n is not None for n in numbers):
        return numbers
    ranges = [mark_range(band.get("marks")) for band in bands]
    if any(r is None for r in ranges):
        return None
    for band, (low, high) in zip(bands, ranges):
        label = band.get("band")
        if high == 0:
            continue  # the no-credit band may be labelled "0 marks"
        if not isinstance(label, str) or len(label.strip()) < 3 or _POINTS_WORDS.search(label):
            return None
    scoring = sorted((i for i, (_, high) in enumerate(ranges) if high > 0), key=lambda i: ranges[i][0])
    if len(scoring) < 2 or any(ranges[a][1] >= ranges[b][0] for a, b in zip(scoring, scoring[1:])):
        return None
    numbers = [0] * len(bands)
    for level, index in enumerate(scoring, start=1):
        numbers[index] = level
    return numbers


def is_level_scale(bands: object) -> bool:
    """bands: a list of {"band": label, "marks": ...} -- an objective's
    ``bands`` or a thread extraction's ``band_marks``."""
    return level_numbers(bands) is not None


def is_points_objective(objective: object) -> bool:
    """True unless the objective is a level scale (so it gets no descriptor
    checks, descriptor IDs or threads -- the same treatment as ao "General")."""
    if not isinstance(objective, dict):
        return True
    ao = objective.get("ao")
    if isinstance(ao, str) and ao.strip().casefold() == "general":
        return True
    return not is_level_scale(objective.get("bands"))
