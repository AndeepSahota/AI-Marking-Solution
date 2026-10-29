"""Run all of an AO's threads through independent specialists and combine.

Each specialist gets its own fresh delimiter token -- the anti-injection
scheme used throughout this pipeline issues one token per request, not one
shared across several, so three specialist calls need three separate
wrap_for_prompt() calls, not one reused wrapping.
"""

import os
import re

from security import ms_ocr_sanitisation
from llm_service import generate_thread_specialist_response, generate_idea_specialist_response
from specialists.calibration import calibration_for, combine_calibrated, fine_score
from specialists.combine import combine_specialist_results, mark_for_level, vote_levels

from specialists.consistency import (
    generate_judgement_specialist_response_consistent,
    generate_thread_specialist_response_consistent,
    generate_reference_specialist_response_consistent,
)

# How many samples the generic (non-judgement) specialists take, median
# vote. 1 = a single call, the gpt-4o behaviour. Raise it for models that
# can't run at temperature 0 (e.g. gpt-6-luna).
#
# NOTE: when this is >1, thread A still falls back to the plain generic
# step-test specialist (generate_thread_specialist_response), not its own
# dedicated idea prompt below -- generate_thread_specialist_response_consistent
# hardcodes which function it ensembles. Not an issue at the gpt-4o default
# (=1), but worth fixing if a reasoning-model swap for threads A/C is
# revisited.
_GENERIC_SAMPLES = int(os.getenv("SPECIALIST_AC_SAMPLES", "1"))

# Hardcoded to AO4's own lettering -- "a" is "ideas, events, themes or
# settings", "b" is "assertions and judgements", "c" is "reference
# selection and support" -- every real essay tested so far is this one AO.
# A different mark scheme's thread lettering is not guaranteed to mean the
# same thing; generalising this beyond AO4 is future work, not attempted
# here.
_JUDGEMENT_THREAD_KEY = "b"
_IDEA_THREAD_KEY = "a"
_REFERENCE_THREAD_KEY = "c"

ENGINE_CURRENT = "current"
ENGINE_GENERAL = "general"

# The general engine runs every thread through the one shared specialist,
# 3 samples at temperature 0.5 (thread B's setting, the one with direct
# evidence of real sample diversity), median vote.
_GENERAL_SAMPLES = 3
_GENERAL_TEMPERATURE = 0.5

# How the general engine turns thread levels into one mark. "vote" (default)
# is majority vote. "calibrated" averages every run of every thread into one
# fine score and cuts it at boundaries learned from teacher-marked essays on
# the same mark scheme (specialists/calibrations.json); schemes with no
# learned boundaries still use the vote.
COMBINE_VOTE = "vote"
COMBINE_CALIBRATED = "calibrated"
_COMBINE_MODE = os.getenv("SPECIALIST_COMBINE", COMBINE_VOTE)

# Calibrated mode runs each thread twice as often (two lots of 3, averaged):
# a single lot's fine score moved ~0.15 between runs -- more than the gap
# between levels -- and averaging two lots took leave-one-out from 13-16/18
# (depending on the run) to 16/18, with the near-boundary flag catching
# every remaining miss.
_CALIBRATED_SAMPLES = 6

# Descriptor IDs the level-climbing code can parse. Real stored schemes
# include OCR misreads such as "a05-4a" (zero for the letter O) -- anything
# that doesn't match is refused rather than guessed at.
_DESCRIPTOR_ID_SHAPE = re.compile(r"^ao\d+-\d+[a-z]+$")
_LEVEL_NUMBER = re.compile(r"-(\d+)[a-z]+$")


def general_engine_ao(question_extraction: dict) -> tuple[str, dict] | None:
    """(ao_key, ao_data) if this question can go through the general engine,
    else None (caller keeps the old route). Requires exactly one AO, that AO
    to have level-based threads (point-based questions such as Q1 are stored
    with no threads), band marks, and every descriptor ID in the parseable
    "ao4-3a" shape."""
    aos = question_extraction.get("assessment_objectives") or {}
    if len(aos) != 1:
        return None
    ao_key, ao_data = next(iter(aos.items()))
    threads = ao_data.get("threads") or {}
    if not threads or not ao_data.get("band_marks"):
        return None
    for thread in threads.values():
        levels = thread.get("levels") or []
        if not levels:
            return None
        if any(not _DESCRIPTOR_ID_SHAPE.match(level.get("descriptor_id", "")) for level in levels):
            return None
    return ao_key, ao_data


def _levels_lowest_first(levels: list[dict]) -> list[dict]:
    # Some stored schemes list levels highest-first; the climbing code
    # assumes lowest-first.
    return sorted(levels, key=lambda level: int(_LEVEL_NUMBER.search(level["descriptor_id"]).group(1)))


def mark_ao_with_specialists(
    question: str,
    essay_text: str,
    ao: dict,
    engine: str = ENGINE_CURRENT,
    holistic_level: int | None = None,
    examples: list[dict] | None = None,
) -> dict:
    """ao: {"ao": "AO4", "marks_available": 15, "band_marks": [...],
    "threads": {"a": {"thread_description": ..., "levels": [...]}, ...}}
    -- same shape already stored in thread_extraction for this AO.

    engine: "current" is the AO4-tuned version (dedicated A/B/C prompts,
    ties to the lower level), kept for comparison. "general" sends every
    thread through the one shared specialist, and uses holistic_level to
    break ties. examples: marked answers from the exemplar store, shown to
    every general-engine specialist -- the caller is responsible for never
    including the essay being marked.
    """
    if engine == ENGINE_GENERAL:
        return _mark_ao_general(question, essay_text, ao, holistic_level, examples)
    if engine != ENGINE_CURRENT:
        raise ValueError(f"Unknown specialist engine: {engine}")

    sanitized = ms_ocr_sanitisation.sanitize(essay_text)

    per_thread_results = []
    total_prompt_tokens = 0
    total_completion_tokens = 0
    for thread_key, thread in ao["threads"].items():
        if thread_key == _JUDGEMENT_THREAD_KEY:
            # Ensembled (n=3, temperature=0.5, median vote) -- this thread's
            # own repeated-run testing showed genuine run-to-run variance at
            # temperature=0, not a prompt flaw. Does its own fresh
            # wrap_for_prompt() per sample, so it takes the sanitized essay
            # directly rather than a single pre-wrapped one.
            result = generate_judgement_specialist_response_consistent(
                question=question,
                sanitized_essay=sanitized,
                thread_description=thread["thread_description"],
                levels=thread["levels"],
            )
            usage = result.pop("usage")
            sample_levels = result.pop("sample_levels")
        elif thread_key == _REFERENCE_THREAD_KEY:
            # Ensembled (n=3, temperature=0.0, median vote) -- this thread's
            # own repeated-run testing (even after sharpening its prompt
            # twice) still showed the same essay flip between two adjacent
            # levels, with no one-directional bias -- genuine noise around a
            # fuzzy boundary, which a median vote is suited to even though
            # the underlying prompt couldn't be made to stop doing it.
            result = generate_reference_specialist_response_consistent(
                question=question,
                sanitized_essay=sanitized,
                thread_description=thread["thread_description"],
                levels=thread["levels"],
            )
            usage = result.pop("usage")
            sample_levels = result.pop("sample_levels")
        elif _GENERIC_SAMPLES > 1:
            result = generate_thread_specialist_response_consistent(
                question=question,
                sanitized_essay=sanitized,
                thread_description=thread["thread_description"],
                levels=thread["levels"],
                n_samples=_GENERIC_SAMPLES,
            )
            usage = result.pop("usage")
            sample_levels = result.pop("sample_levels")
        else:
            wrapped, token = ms_ocr_sanitisation.wrap_for_prompt(sanitized)
            specialist_call = (
                generate_idea_specialist_response
                if thread_key == _IDEA_THREAD_KEY
                else generate_thread_specialist_response
            )
            result, performance = specialist_call(
                question=question,
                student_response=wrapped,
                thread_description=thread["thread_description"],
                levels=thread["levels"],
                expected_token=token,
                include_performance=True,
            )
            usage = performance
            sample_levels = None

        per_thread_entry = {"thread_key": thread_key, **result}
        if sample_levels is not None:
            per_thread_entry["sample_levels"] = sample_levels
        per_thread_results.append(per_thread_entry)
        total_prompt_tokens += usage.get("prompt_tokens") or 0
        total_completion_tokens += usage.get("completion_tokens") or 0

    combined = combine_specialist_results(per_thread_results)
    return _result(ao, combined, per_thread_results, total_prompt_tokens, total_completion_tokens)


def _mark_ao_general(
    question: str,
    essay_text: str,
    ao: dict,
    holistic_level: int | None,
    examples: list[dict] | None,
) -> dict:
    sanitized = ms_ocr_sanitisation.sanitize(essay_text)
    calibration = calibration_for(ao) if _COMBINE_MODE == COMBINE_CALIBRATED else None
    n_samples = _CALIBRATED_SAMPLES if calibration else _GENERAL_SAMPLES

    per_thread_results = []
    total_prompt_tokens = 0
    total_completion_tokens = 0
    for thread_key, thread in ao["threads"].items():
        result = generate_thread_specialist_response_consistent(
            question=question,
            sanitized_essay=sanitized,
            thread_description=thread["thread_description"],
            levels=_levels_lowest_first(thread["levels"]),
            n_samples=n_samples,
            temperature=_GENERAL_TEMPERATURE,
            examples=examples,
        )
        usage = result.pop("usage")
        sample_levels = result.pop("sample_levels")
        per_thread_results.append({"thread_key": thread_key, **result, "sample_levels": sample_levels})
        total_prompt_tokens += usage.get("prompt_tokens") or 0
        total_completion_tokens += usage.get("completion_tokens") or 0

    combined = combine_specialist_results(per_thread_results, holistic_level=holistic_level)
    result = _result(ao, combined, per_thread_results, total_prompt_tokens, total_completion_tokens)
    result["run_levels"] = _complete_run_levels(per_thread_results, holistic_level)
    result["review_flag"] = len(set(result["run_levels"])) > 1
    result["combine_mode"] = COMBINE_VOTE

    if calibration:
        calibrated = combine_calibrated(
            per_thread_levels=[_level_number(entry["descriptor_id"]) for entry in per_thread_results],
            score=fine_score(per_thread_results),
            band_marks=ao["band_marks"],
            calibration=calibration,
        )
        result.update({
            "awarded_band": calibrated["band"],
            "marks": calibrated["marks"],
            "fine_score": calibrated["fine_score"],
            # Replaces the run-disagreement flag: on the 18 test essays,
            # sitting near a learned boundary caught the misses far better.
            "review_flag": calibrated["near_boundary"],
            "combine_mode": COMBINE_CALIBRATED,
        })
    return result


def _level_number(descriptor_id: str) -> int:
    return int(_LEVEL_NUMBER.search(descriptor_id).group(1))


def _complete_run_levels(per_thread_results: list[dict], holistic_level: int | None) -> list[int]:
    """Treat sample i of every thread as one complete marking, and give the
    final level each of those complete runs would have produced on its own.
    If they differ, the run-to-run disagreement would change the final
    level -- the only disagreement worth asking a teacher about."""
    sample_lists = [entry["sample_levels"] for entry in per_thread_results]
    return [
        vote_levels([samples[i] for samples in sample_lists], holistic_level)[0]
        for i in range(min(len(s) for s in sample_lists))
    ]


def _result(ao, combined, per_thread_results, prompt_tokens, completion_tokens) -> dict:
    awarded = mark_for_level(combined["overall_level"], ao["band_marks"])
    return {
        "ao": ao["ao"],
        "awarded_band": awarded["band"],
        "marks": awarded["marks"],
        "max_marks": ao["marks_available"],
        "missing_threads": combined["missing_threads"],
        "tie_break": combined["tie_break"],
        "per_thread": per_thread_results,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        },
    }
