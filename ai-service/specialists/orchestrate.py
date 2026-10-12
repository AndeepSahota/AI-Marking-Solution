"""Run all of an AO's threads through independent specialists and combine.

Each specialist gets its own fresh delimiter token -- the anti-injection
scheme used throughout this pipeline issues one token per request, not one
shared across several, so three specialist calls need three separate
wrap_for_prompt() calls, not one reused wrapping.
"""

from security import ms_ocr_sanitisation
from llm_service import generate_thread_specialist_response
from specialists.combine import combine_specialist_results, mark_for_level
import os

from specialists.consistency import (
    generate_judgement_specialist_response_consistent,
    generate_thread_specialist_response_consistent,
)

# How many samples the generic (non-judgement) specialists take, median
# vote. 1 = a single call, the gpt-4o behaviour. Raise it for models that
# can't run at temperature 0 (e.g. gpt-6-luna).
_GENERIC_SAMPLES = int(os.getenv("SPECIALIST_AC_SAMPLES", "1"))

# Hardcoded to AO4's own lettering, where "b" is specifically the
# "assertions and judgements" thread -- every real essay tested so far is
# this one AO. A different mark scheme's thread lettering is not guaranteed
# to mean the same thing; generalising this beyond AO4 is future work, not
# attempted here.
_JUDGEMENT_THREAD_KEY = "b"


def mark_ao_with_specialists(question: str, essay_text: str, ao: dict) -> dict:
    """ao: {"ao": "AO4", "marks_available": 15, "band_marks": [...],
    "threads": {"a": {"thread_description": ..., "levels": [...]}, ...}}
    -- same shape already stored in thread_extraction for this AO.
    """
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
            result, performance = generate_thread_specialist_response(
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
    awarded = mark_for_level(combined["overall_level"], ao["band_marks"])

    return {
        "ao": ao["ao"],
        "awarded_band": awarded["band"],
        "marks": awarded["marks"],
        "max_marks": ao["marks_available"],
        "missing_threads": combined["missing_threads"],
        "per_thread": per_thread_results,
        "usage": {
            "prompt_tokens": total_prompt_tokens,
            "completion_tokens": total_completion_tokens,
        },
    }
