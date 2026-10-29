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

_CALIBRATIONS = json.loads((Path(__file__).parent / "calibrations.json").read_text())
_BAND_NUMBER_DIGITS = "0123456789"
_LOWEST_SCORE = 1.0  # the lowest a thread level can be


def calibration_for(ao: dict) -> dict | None:
    key = scheme_fingerprint({"assessment_objectives": {ao["ao"]: {"threads": ao["threads"]}}})
    return _CALIBRATIONS.get(key)


def fine_score(per_thread_results: list[dict]) -> float:
    """Average level across every thread and every run of each thread."""
    values = [level for entry in per_thread_results for level in entry["sample_levels"]]
    return sum(values) / len(values)


def _band_number(band: dict) -> int:
    return int("".join(ch for ch in band["band"] if ch in _BAND_NUMBER_DIGITS))


def combine_calibrated(per_thread_levels: list[int], score: float, band_marks: list[dict], calibration: dict) -> dict:
    """per_thread_levels: each thread's own (median-voted) level -- used only
    for the top-level rule. score: the essay's fine score."""
    cuts = calibration["cuts"]
    bands = sorted(band_marks, key=_band_number)
    top_level = _band_number(bands[-1])

    level = 1 + sum(score > cut for cut in cuts)
    # Levels above the highest learned cut have no teacher-marked essays to
    # set a boundary from -- only award one if most threads' climbs reach it.
    for higher in range(len(cuts) + 2, top_level + 1):
        if sum(lv >= higher for lv in per_thread_levels) * 2 > len(per_thread_levels):
            level = higher

    band = next(b for b in bands if _band_number(b) == level)
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
    return {
        "overall_level": level,
        "band": band["band"],
        "marks": marks,
        "fine_score": round(score, 3),
        "near_boundary": min(abs(score - cut) for cut in cuts) <= margin,
    }
