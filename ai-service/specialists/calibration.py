"""Calibrated combining: one fine score per essay, cut into levels by
boundaries learned from teacher-marked essays on the same mark scheme.

Why: on 18 teacher-marked AO4 essays the general engine ranked essays almost
exactly like the teacher (Spearman 0.95 on the fine score) but majority vote
put the level boundaries in the wrong place (8/18 right level). Learned
boundaries got 16/18 leave-one-out. Boundaries only exist for mark schemes
listed in calibrations.json -- anything else keeps majority vote.
"""

import json
from pathlib import Path

from final_marking.context import mark_range
from rag_service import scheme_fingerprint
from specialists.combine import _numbers as band_level_numbers

_CALIBRATIONS = json.loads((Path(__file__).parent / "calibrations.json").read_text())
_LOWEST_SCORE = 1.0  # the lowest a thread level can be


def scheme_key_for(ao: dict) -> str | None:
    return scheme_fingerprint({"assessment_objectives": {ao["ao"]: {"threads": ao["threads"]}}})


def calibration_for(ao: dict) -> dict | None:
    return _CALIBRATIONS.get(scheme_key_for(ao))


def fine_score(per_thread_results: list[dict]) -> float:
    """Average level across every thread and every run of each thread."""
    values = [level for entry in per_thread_results for level in entry["sample_levels"]]
    return sum(values) / len(values)


def combine_calibrated(per_thread_levels: list[int], score: float, band_marks: list[dict], calibration: dict) -> dict:
    """per_thread_levels: each thread's own (median-voted) level -- used only
    for the top-level rule. score: the essay's fine score."""
    cuts = calibration["cuts"]
    numbered = sorted(zip(band_level_numbers(band_marks), band_marks), key=lambda pair: pair[0])
    bands = [band for _, band in numbered]
    number_of = {id(band): number for number, band in numbered}
    top_level = number_of[id(bands[-1])]

    level = 1 + sum(score > cut for cut in cuts)
    # Levels above the highest learned cut have no teacher-marked essays to
    # set a boundary from -- only award one if most threads' climbs reach it.
    for higher in range(len(cuts) + 2, top_level + 1):
        if sum(lv >= higher for lv in per_thread_levels) * 2 > len(per_thread_levels):
            level = higher

    band = next(b for b in bands if number_of[id(b)] == level)
    low, high = mark_range(band["marks"])
    # The score range this level covers, so the mark can sit where the essay
    # sits within it. Levels above the highest cut share the range from that
    # cut up to the top of the scale.
    if level == 1:
        lower_edge = _LOWEST_SCORE
    elif level - 2 < len(cuts):
        lower_edge = cuts[level - 2]
    else:
        lower_edge = cuts[-1]
    upper_edge = cuts[level - 1] if level <= len(cuts) else float(top_level)
    position = (score - lower_edge) / (upper_edge - lower_edge) if upper_edge > lower_edge else 0.0
    marks = round(low + max(0.0, min(1.0, position)) * (high - low))

    margin = calibration["near_boundary_margin"]
    nearest = min(range(len(cuts)), key=lambda i: abs(score - cuts[i]))
    near_boundary = abs(score - cuts[nearest]) <= margin
    return {
        "overall_level": level,
        "band": band["band"],
        "marks": marks,
        "fine_score": round(score, 3),
        "near_boundary": near_boundary,
        # The two levels either side of the nearest boundary -- cut i sits
        # between Level i+1 and Level i+2.
        "borderline_levels": [nearest + 1, nearest + 2] if near_boundary else None,
    }
