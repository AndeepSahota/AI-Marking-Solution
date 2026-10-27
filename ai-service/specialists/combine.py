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


def vote_levels(levels: list[int], holistic_level: int | None = None) -> tuple[int, str | None]:
    """Majority vote over thread levels -> (level, how a tie was broken)."""
    counts = Counter(levels)
    top_count = max(counts.values())
    tied_levels = sorted(level for level, c in counts.items() if c == top_count)
    if len(tied_levels) > 1 and holistic_level is not None:
        return min(tied_levels, key=lambda level: (abs(level - holistic_level), level)), "holistic"
    return tied_levels[0], ("lower" if len(tied_levels) > 1 else None)


def combine_specialist_results(results: list[dict], holistic_level: int | None = None) -> dict:
    """results: one dict per thread, each with "thread_key", "descriptor_id",
    "evidence", "reasoning" (the specialist's own raw output plus its
    thread_key attached by the caller).

    Majority vote across the threads' levels. On a tie, the tied level
    closest to holistic_level wins (the holistic mark is already computed
    before the specialists run, so it costs nothing extra). With no
    holistic_level, or when two tied levels are equally close to it, the
    lower one wins -- the original "don't give the benefit of the doubt"
    rule. Note: the holistic marker is the stage known to drift toward the
    middle, so this tie-break leans ties toward the middle too.

    missing_threads: any thread whose specialist found zero evidence at all
    -- a plain fact worth surfacing, same as the existing missing-thread
    flag, just now known directly from the specialist's own answer rather
    than inferred after the fact.
    """
    levels = [_level_of(r["descriptor_id"]) for r in results]
    levels = [level for level in levels if level is not None]
    if not levels:
        raise ValueError("No valid descriptor levels in specialist results")

    overall_level, tie_break = vote_levels(levels, holistic_level)

    missing_threads = [r["thread_key"] for r in results if not r["evidence"]]

    return {
        "overall_level": overall_level,
        "per_thread": results,
        "missing_threads": missing_threads,
        "tie_break": tie_break,
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
