"""Whether a mark scheme objective is a level scale or a points section.

One rule for the whole mark scheme step (descriptor checks, descriptor IDs,
the specialist router) and the backend's review screens
(backend/src/services/reviewService.js levelsFor): a level scale has at least
two bands and every band is labelled like a level -- "Level 3", "Band 2" or a
bare number such as a "0" band. Anything else is a points section: lists of
acceptable answers, "1 mark"/"2 marks" rows, indicative content, or a
"General" placeholder. The extraction prompt asks for those as ao "General",
but the model often names a real AO instead ("AO1" with a "General" band), so
the decision is made from the bands, not the AO label.
"""

import re

_LEVEL_LABEL = re.compile(r"^\s*(?:(?:level|band)\s*)?(\d+)\s*$", re.IGNORECASE)


def level_number(label: object) -> int | None:
    """3 for "Level 3", "Band 3" or "3"; None for anything else."""
    match = _LEVEL_LABEL.match(label) if isinstance(label, str) else None
    return int(match.group(1)) if match else None


def is_level_scale(bands: object) -> bool:
    """bands: a list of {"band": label, ...} -- an objective's ``bands`` or a
    thread extraction's ``band_marks``."""
    if not isinstance(bands, list) or len(bands) < 2:
        return False
    return all(isinstance(band, dict) and level_number(band.get("band")) is not None for band in bands)


def is_points_objective(objective: object) -> bool:
    """True unless the objective is a level scale (so it gets no descriptor
    checks, descriptor IDs or threads -- the same treatment as ao "General")."""
    if not isinstance(objective, dict):
        return True
    ao = objective.get("ao")
    if isinstance(ao, str) and ao.strip().casefold() == "general":
        return True
    return not is_level_scale(objective.get("bands"))
