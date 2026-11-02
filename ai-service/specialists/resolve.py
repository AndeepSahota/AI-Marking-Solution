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


_DESCRIPTOR_ID = re.compile(r"\bao\d+-\d+[a-z]+\b", re.IGNORECASE)
_MENTIONS_LEVEL = re.compile(r"\blevel\s*\d", re.IGNORECASE)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_REASON_MAX_WORDS = 30


def _teacher_reason(entry: dict) -> str:
    """One plain-English line for a thread, taken from the explanation of the
    quote that earned its level. Teachers never see thread levels, letters or
    descriptor IDs, so sentences that mention them are skipped."""
    if not entry.get("evidence"):
        return "No clear evidence found for this skill."
    explanation = entry["evidence"][-1]["explanation"] or ""
    explanation = re.sub(r"\s*\(matches:.*?\)", "", explanation)
    for sentence in _SENTENCE_END.split(explanation.strip()):
        sentence = sentence.strip()
        if not sentence or _DESCRIPTOR_ID.search(sentence) or _MENTIONS_LEVEL.search(sentence):
            continue
        words = sentence.split()
        return " ".join(words[:_REASON_MAX_WORDS]) + ("…" if len(words) > _REASON_MAX_WORDS else "")
    return "Evidence found for this skill."


def _engine_block(specialist_result: dict, threads: dict) -> dict:
    """What the review screen needs, plus what calibration needs later.
    fine_score and scheme_key are internal -- the backend stores them but
    never sends them to a browser."""
    return {
        "level": _level_of_band(specialist_result["awarded_band"]),
        "mark": specialist_result["marks"],
        "max_mark": specialist_result["max_marks"],
        "combine_mode": specialist_result.get("combine_mode"),
        "runs_per_thread": specialist_result.get("runs_per_thread"),
        "fine_score": specialist_result.get("fine_score"),
        "scheme_key": specialist_result.get("scheme_key"),
        "borderline": bool(specialist_result.get("review_flag")),
        "borderline_levels": specialist_result.get("borderline_levels"),
        "threads": [
            {
                "label": threads[entry["thread_key"]]["thread_description"].strip().rstrip("."),
                "reason": _teacher_reason(entry),
            }
            for entry in specialist_result["per_thread"]
        ],
    }


def _level_of_band(band: str) -> int | None:
    digits = "".join(ch for ch in band if ch.isdigit())
    return int(digits) if digits else None


def _combine_description(specialist_result: dict) -> str:
    if specialist_result.get("combine_mode") == "calibrated":
        return "by a calibrated score against teacher-marked essays"
    return "by majority vote"


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
                f"{_combine_description(specialist_result)}: {specialist_result['awarded_band']}."
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
            "engine": _engine_block(specialist_result, threads),
        },
    }
