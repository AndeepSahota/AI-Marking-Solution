"""Repair assessment objective names the OCR or the model got wrong, before
descriptor IDs are built from them (validation/descriptor_id_enrichment.py).

- "A05" (a zero for the letter O, seen on the AQA Language scheme) -> "AO5".
  Its IDs came out as "a05-4a", which the specialist router refuses.
- "AO5/AO6" when the question's other objective is AO6 -> "AO5" (Edexcel
  Language writing grids: the 24-mark grid came back labelled with both
  objectives, the 16-mark one as AO6). Its IDs were "ao5-ao6-1a". Left alone
  unless exactly one of the named objectives is not already used.
"""

import copy
import re
from typing import Any

_ZERO_FOR_O = re.compile(r"^\s*A\s*0\s*(\d+)\s*$", re.IGNORECASE)
_SINGLE = re.compile(r"^\s*AO\s*(\d+)\s*$", re.IGNORECASE)
_COMBINED = re.compile(r"^\s*AO\s*\d+(?:\s*(?:/|&|and|\+)\s*AO\s*\d+)+\s*$", re.IGNORECASE)


def _single(name: object) -> str | None:
    if not isinstance(name, str):
        return None
    match = _ZERO_FOR_O.match(name) or _SINGLE.match(name)
    return f"AO{int(match.group(1))}" if match else None


def fix_ao_names(question: dict[str, Any]) -> dict[str, Any]:
    """A copy of the question with repaired objective names; unchanged if
    nothing needs repairing."""
    objectives = question.get("assessment_objectives")
    if not isinstance(objectives, list):
        return question
    fixed = copy.deepcopy(question)
    for objective in fixed["assessment_objectives"]:
        if isinstance(objective, dict) and isinstance(objective.get("ao"), str) and _ZERO_FOR_O.match(objective["ao"]):
            objective["ao"] = _single(objective["ao"])
    used = {_single(o.get("ao")) for o in fixed["assessment_objectives"] if isinstance(o, dict)} - {None}
    for objective in fixed["assessment_objectives"]:
        name = objective.get("ao") if isinstance(objective, dict) else None
        if isinstance(name, str) and _COMBINED.match(name):
            free = [f"AO{n}" for n in dict.fromkeys(int(n) for n in re.findall(r"\d+", name)) if f"AO{n}" not in used]
            if len(free) == 1:
                objective["ao"] = free[0]
                used.add(free[0])
    return fixed
