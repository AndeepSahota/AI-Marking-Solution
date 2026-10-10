"""Combine independent per-thread specialist verdicts into one overall band.

Deliberately pure code, no LLM call -- every time a combining step was left
to another model call elsewhere in this pipeline, it drifted toward the
middle regardless of the evidence. This is the one place that doesn't.
"""

import re
from collections import Counter

from final_marking.context import mark_range

_LEVEL = re.compile(r"-(\d+)[a-z]+$")
_BAND_NUMBER = re.compile(r"\d+")


def _level_of(descriptor_id: str) -> int | None:
    match = _LEVEL.search(descriptor_id)
    return int(match.group(1)) if match else None


def combine_specialist_results(results: list[dict]) -> dict:
    """results: one dict per thread, each with "thread_key", "descriptor_id",
    "evidence", "reasoning" (the specialist's own raw output plus its
    thread_key attached by the caller).

    Majority vote across the threads' levels, tie goes to the lower band --
    the same real exam-board "don't give the benefit of the doubt" rule
    already used elsewhere in this pipeline, not invented for this.

    missing_threads: any thread whose specialist found zero evidence at all
    -- a plain fact worth surfacing, same as the existing missing-thread
    flag, just now known directly from the specialist's own answer rather
    than inferred after the fact.
    """
    levels = [_level_of(r["descriptor_id"]) for r in results]
    levels = [level for level in levels if level is not None]
    if not levels:
        raise ValueError("No valid descriptor levels in specialist results")

    counts = Counter(levels)
    top_count = max(counts.values())
    tied_levels = [level for level, c in counts.items() if c == top_count]
    overall_level = min(tied_levels)

    missing_threads = [r["thread_key"] for r in results if not r["evidence"]]

    return {
        "overall_level": overall_level,
        "per_thread": results,
        "missing_threads": missing_threads,
    }


def mark_for_level(overall_level: int, band_marks: list[dict]) -> dict:
    """The specific mark and band label for the voted-on level.

    A band is a range, not one number -- Level 1 here covers marks 1-3, not
    just "1". Takes the midpoint of that range (rounds down on an even-width
    range, consistent with "don't give the benefit of the doubt" elsewhere
    in this pipeline) rather than guessing where within the band the
    response actually sits.

    band_marks: the AO's own band_marks list, e.g.
    [{"band": "Level 1", "marks": "1-3"}, ...] -- same shape already used
    throughout final_marking/context.py.
    """
    for band in band_marks:
        match = _BAND_NUMBER.search(band["band"])
        if match and int(match.group()) == overall_level:
            low, high = mark_range(band["marks"])
            return {"band": band["band"], "marks": (low + high) // 2}
    raise ValueError(f"No band found for level {overall_level} in supplied band_marks")
