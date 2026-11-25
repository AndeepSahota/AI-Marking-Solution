"""Split a multi-objective question into parts the general engine can mark.

A part is one grid that gets one level and one mark. Real papers combine
objectives three ways (hold-out schemes, 2026-11-18):
- one grid for several objectives, one mark -- AQA Literature: AO1-AO3
  under one 30-mark grid;
- each objective its own grid, marks added -- writing: AO5 /24 + AO6 /16;
- mixed -- Edexcel Literature: an AO1/AO3 grid /32 plus an AO4 grid /8.

Objectives whose bands have identical mark ranges may share one grid, but
that alone doesn't settle it (Edexcel Literature Paper 2 Q1b: AO1 and AO2
look the same, yet its 40 marks say they are marked separately), so the
question's marks decide:
- the grids' top marks add up to the question's marks -> one part per grid;
- each objective's top mark adds up to them -> one part per objective;
- the grids add up to more by exactly one single-objective grid's top mark
  (a spelling grid the outline left out of the question's marks: Edexcel's
  32 + 8) -> one part per grid, out of the larger total.
Anything else, or unknown marks, returns None and the old pipeline marks
the question rather than guessing.
"""

import re

from specialists.thread_tidy import tidy_threads
from validation.band_levels import is_level_scale, mark_range

_DESCRIPTOR_ID_SHAPE = re.compile(r"^ao\d+-\d+[a-z]+$")  # same rule as orchestrate.general_engine_ao


def _markable(ao_data: dict) -> bool:
    threads = ao_data.get("threads") or {}
    if not threads or not is_level_scale(ao_data.get("band_marks")):
        return False
    return all(
        thread.get("levels") and all(_DESCRIPTOR_ID_SHAPE.match(level.get("descriptor_id", "")) for level in thread["levels"])
        for thread in threads.values()
    )


def _grid(ao_data: dict) -> tuple:
    return tuple(sorted(mark_range(band.get("marks")) or (-1, -1) for band in ao_data.get("band_marks") or []))


def _top(grid: tuple) -> int:
    return max(high for _, high in grid)


def _part(ao_keys: list[str], objectives: dict) -> dict:
    """The dict mark_ao_with_specialists() takes. Thread keys carry their
    objective ("AO5:b+c") -- two objectives both have a thread "a"."""
    threads = {}
    for ao_key in ao_keys:
        for key, thread in tidy_threads(objectives[ao_key]).items():
            threads[f"{ao_key}:{key}"] = thread
    band_marks = objectives[ao_keys[0]]["band_marks"]
    return {
        "ao": "+".join(ao_keys),
        "aos": list(ao_keys),
        "marks_available": _top(_grid(objectives[ao_keys[0]])),
        "band_marks": band_marks,
        "threads": threads,
    }


def question_parts(question: dict) -> list[dict] | None:
    """Parts for a question with two or more objectives, or None if it
    should stay on the old pipeline."""
    objectives = question.get("assessment_objectives") or {}
    marks = question.get("marks_available")
    if len(objectives) < 2 or not isinstance(marks, int) or marks < 1:
        return None
    if not all(_markable(ao_data) for ao_data in objectives.values()):
        return None
    grids: dict[tuple, list[str]] = {}
    for ao_key, ao_data in objectives.items():
        grids.setdefault(_grid(ao_data), []).append(ao_key)

    by_grid = sum(_top(grid) for grid in grids)
    by_objective = sum(_top(grid) * len(keys) for grid, keys in grids.items())
    extra_grids = {_top(grid) for grid, keys in grids.items() if len(keys) == 1}
    if marks == by_grid or (by_grid > marks and by_grid - marks in extra_grids):
        groups = list(grids.values())
    elif marks == by_objective:
        groups = [[ao_key] for ao_key in objectives]
    else:
        return None
    return [_part(keys, objectives) for keys in groups]


def holistic_level_for(part: dict, rubric_breakdown: object) -> int | None:
    """The holistic marker's level for this part, to break ties: the first
    breakdown row naming one of the part's objectives."""
    for row in rubric_breakdown if isinstance(rubric_breakdown, list) else []:
        if not isinstance(row, dict):
            continue
        criterion = str(row.get("criterion") or "").upper().replace(" ", "")
        if any(ao.upper() in criterion for ao in part["aos"]):
            match = re.search(r"\d+", str(row.get("awarded_band") or ""))
            return int(match.group()) if match else None
    return None
