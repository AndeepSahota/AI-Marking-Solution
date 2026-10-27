"""Self-consistency wrapper for the judgement specialist specifically.

Direct evidence this is needed, not a guess: running the same essay through
the judgement specialist 5 times at temperature=0 (the normal, supposedly
deterministic setting) produced two different answers -- 3 of 5 one level,
2 of 5 another. Same philosophy as this project's own holistic-marker
self-consistency: only the LEVEL is a vote across samples; the qualitative
evidence and reasoning always come from one single representative sample,
never blended across several.
"""

import re
from collections import Counter
from statistics import median

from security import ms_ocr_sanitisation
from llm_service import (
    generate_judgement_specialist_response,
    generate_thread_specialist_response,
    generate_reference_specialist_response,
)

_LEVEL_SUFFIX = re.compile(r"-(\d+)[a-z]+$")


def _level_of(descriptor_id: str) -> int:
    match = _LEVEL_SUFFIX.search(descriptor_id)
    return int(match.group(1))


def generate_judgement_specialist_response_consistent(
    question: str,
    sanitized_essay: str,
    thread_description: str,
    levels: list[dict],
    n_samples: int = 3,
    temperature: float = 0.5,
) -> dict:
    return _median_of_samples(
        generate_judgement_specialist_response,
        question, sanitized_essay, thread_description, levels, n_samples,
        temperature=temperature,
    )


def generate_thread_specialist_response_consistent(
    question: str,
    sanitized_essay: str,
    thread_description: str,
    levels: list[dict],
    n_samples: int = 3,
    temperature: float = 0.0,
    examples: list[dict] | None = None,
) -> dict:
    """Same median vote for the shared step-test specialist. Used by the
    general engine (every thread, temperature 0.5 -- the setting that showed
    real sample diversity for thread B) and by reasoning models such as
    gpt-6-luna, which ignore temperature, so a single call is noticeably
    random."""
    return _median_of_samples(
        generate_thread_specialist_response,
        question, sanitized_essay, thread_description, levels, n_samples,
        temperature=temperature,
        examples=examples,
    )


def generate_reference_specialist_response_consistent(
    question: str,
    sanitized_essay: str,
    thread_description: str,
    levels: list[dict],
    n_samples: int = 3,
) -> dict:
    """Same median vote for the reference specialist (thread C) -- direct
    evidence this is needed, not a guess: running the same essay through
    this thread's prompt 3 times in a row (even after sharpening its
    wording twice) still produced two different answers across adjacent
    levels. See scripts/thread_c_descriptor_echo_diagnosis.txt for the
    real evidence this instability isn't a one-directional bias, which is
    what makes a median vote the right tool here rather than another
    prompt rewrite.
    """
    return _median_of_samples(
        generate_reference_specialist_response,
        question, sanitized_essay, thread_description, levels, n_samples,
    )


def _median_of_samples(generate, question, sanitized_essay, thread_description, levels, n_samples, **extra):
    """sanitized_essay: already through ms_ocr_sanitisation.sanitize() --
    this function does its own wrap_for_prompt() per sample, since each of
    the n_samples calls needs its own fresh anti-injection token, the same
    rule every other multi-call stage in this pipeline already follows.
    """
    samples = []
    total_prompt_tokens = 0
    total_completion_tokens = 0

    for _ in range(n_samples):
        wrapped, token = ms_ocr_sanitisation.wrap_for_prompt(sanitized_essay)
        result, performance = generate(
            question=question,
            student_response=wrapped,
            thread_description=thread_description,
            levels=levels,
            expected_token=token,
            include_performance=True,
            **extra,
        )
        samples.append(result)
        total_prompt_tokens += performance.get("prompt_tokens") or 0
        total_completion_tokens += performance.get("completion_tokens") or 0

    sample_levels = [_level_of(s["descriptor_id"]) for s in samples]
    median_level = round(median(sample_levels))

    # If no sample landed exactly on the (possibly interpolated) median,
    # fall back to whichever level actually occurred most often -- always a
    # real sample's own answer, never a number nobody actually gave.
    if median_level not in sample_levels:
        counts = Counter(sample_levels)
        median_level = counts.most_common(1)[0][0]

    representative = next(s for s in samples if _level_of(s["descriptor_id"]) == median_level)

    return {
        **representative,
        "sample_levels": sample_levels,
        "usage": {
            "prompt_tokens": total_prompt_tokens,
            "completion_tokens": total_completion_tokens,
        },
    }
