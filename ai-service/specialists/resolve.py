"""Turn a mark_ao_with_specialists() result into the same final_result shape
the existing single-call final marking produces, so the frontend (which
only knows how to render that one shape -- see workers/utils/sanitizeFinalResult.js)
can show a specialist-marked essay without any changes on its side.

No LLM call here, and no re-validation of quote fidelity -- that trust is
already established at the point the specialist LLM call returns, same as
every other specialist-pipeline file. This is pure reshaping.
"""

import re

_LEVEL = re.compile(r"-(\d+)[a-z]+$")


def _level_of(descriptor_id: str) -> int | None:
    match = _LEVEL.search(descriptor_id)
    return int(match.group(1)) if match else None


def resolve_specialist_final_result(specialist_result: dict, threads: dict) -> dict:
    """specialist_result: the dict returned by mark_ao_with_specialists().
    threads: the same ao["threads"] dict passed into mark_ao_with_specialists,
    used only to label the per-thread summary in plain English.
    """
    summary_parts = []
    evidence = []
    for entry in specialist_result["per_thread"]:
        thread_key = entry["thread_key"]
        label = threads[thread_key]["thread_description"]
        level = _level_of(entry["descriptor_id"])
        summary_parts.append(
            f"{label}: Level {level}" if level is not None else f"{label}: not addressed"
        )
        for index, item in enumerate(entry["evidence"], 1):
            evidence.append({
                "evidence_id": f"{thread_key}-{index}",
                "quote": item["quote"],
                "explanation": item["explanation"],
                "summary": item["explanation"],
                "descriptor_ids": [entry["descriptor_id"]],
            })

    score = specialist_result["marks"]
    max_score = specialist_result["max_marks"]

    return {
        "status": "complete",
        "result": {
            "score": score,
            "original_score": score,
            "delta": 0,
            "max_score": max_score,
            "original_max_score": max_score,
            "max_score_delta": 0,
            "summary": (
                f"Marked by independent specialists, one per thread, combined "
                f"by majority vote: {specialist_result['awarded_band']}."
            ),
            "breakdown": [{
                "section": specialist_result["ao"],
                "awarded_band": specialist_result["awarded_band"],
                "marks": score,
                "max_marks": max_score,
                "summary": " ".join(summary_parts),
            }],
            "evidence": evidence,
            # Also flagged when the specialist runs disagree in a way that
            # changes the final level (general engine only).
            "teacher_review_required": bool(
                specialist_result["missing_threads"] or specialist_result.get("review_flag")
            ),
            "featured_evidence_by_thread": [],
        },
    }
