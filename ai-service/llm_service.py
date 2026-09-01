import os
import json
from openai import OpenAI, LengthFinishReasonError, ContentFilterFinishReasonError
from dotenv import load_dotenv
from prompts import SYSTEM_PROMPT, build_user_prompt, EXTRACTION_SYSTEM_PROMPT, build_extraction_prompt
from security.ms_ocr_sanitisation import verify_token, TokenMismatchError
from schemas.ms_schema import MarkSchemeExtraction
from schemas.marking_result_schema import MarkingResult
from observability.event_log import (
    log_extraction_refusal,
    log_extraction_truncated,
    log_extraction_filtered,
    log_extraction_empty,
    log_marking_refusal,
    log_marking_truncated,
    log_marking_filtered,
    log_marking_empty,
    log_marking_scheme_mismatch,
    log_marking_missing_aos,
)


class ExtractionError(Exception):
    """Common base for every way an extraction call can fail to produce a
    trustworthy result. Lets a caller catch all of them at once with
    `except ExtractionError`, or a specific one when it wants to respond
    differently per failure type."""
    pass


class ExtractionRefusedError(ExtractionError):
    """Raised when the model declines to fulfil an extraction request (e.g.
    for safety reasons) instead of returning a Structured Outputs result.
    With response_format set, a refusal does not populate message.parsed —
    it populates message.refusal instead, so this must be checked before
    .parsed is touched at all."""
    pass


class ExtractionTruncatedError(ExtractionError):
    """Raised when the response hit its length limit before finishing. The
    SDK itself detects this and raises LengthFinishReasonError from inside
    .parse() — this wraps that so callers only need to know about our own
    exception types, not OpenAI's SDK-internal ones."""
    pass


class ExtractionFilteredError(ExtractionError):
    """Raised when OpenAI's content filter blocked the response, independent
    of anything the model itself decided — distinct from ExtractionRefusedError,
    which is the model explicitly declining. The SDK raises
    ContentFilterFinishReasonError from inside .parse(); this wraps that the
    same way ExtractionTruncatedError wraps the length error."""
    pass


class ExtractionIncompleteError(ExtractionError):
    """Raised when there is no parsed result and none of the above explain
    why — message.parsed came back None without a refusal, truncation, or
    content-filter signal. A backstop so this fails loudly with a clear
    reason instead of crashing later with an unrelated AttributeError the
    first time something tries to use the missing result."""
    pass


# This line reads the .env file and loads the variables in the enviroment
# Without this, python has no idea my API key exists
load_dotenv()

# This creates the OpenAI client object
# It automatically looks for OPEN_AI_KEY in your enviroment variables
# This is why the key is never hardcoded - it is pulled securly from .env
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _normalize_ao(name: str) -> str:
    return (name or "").strip().casefold()


def extract_mark_scheme(scheme_text, expected_token):
    user_prompt = build_extraction_prompt(scheme_text)

    # The SDK checks finish_reason itself and raises these two directly from
    # inside .parse() — they never reach the .refusal check below, so they
    # need their own try/except around the call itself, not a field check
    # on the response afterward.
    try:
        response = client.chat.completions.parse(
            model="gpt-4o",
            temperature=0,
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt}
            ],
            response_format=MarkSchemeExtraction,
        )
    except LengthFinishReasonError as e:
        log_extraction_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_extraction_filtered()
        raise ExtractionFilteredError(str(e)) from e

    message = response.choices[0].message

    # A refusal does not populate .parsed — checked first, before anything
    # downstream assumes a result exists at all.
    if message.refusal:
        log_extraction_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed

    if result is None:
        log_extraction_empty()
        raise ExtractionIncompleteError(
            "No parsed result, refusal, truncation, or content-filter signal was returned"
        )

    # delimiter_token is an integrity check, not part of the mark scheme
    # structure the rest of the app expects back. Raises TokenMismatchError
    # on failure — a mismatch means we can't trust this result reflects the
    # genuine boundary, so the request should fail rather than return
    # something unverified.
    verify_token(expected_token, result.delimiter_token)

    return result.model_dump(exclude={"delimiter_token"})


# The shared marking engine. Makes ONE API call requesting `n` independent
# completions (via OpenAI's `n` parameter — cheaper and faster than n separate
# calls, since input tokens are billed once and only output tokens scale with
# n), then parses/scores/verifies each one independently, so one bad
# completion (refusal, truncation, a token mismatch) doesn't take the whole
# batch down. generate_llm_response below calls this with n=1 for today's
# single-call behaviour; a future n=3 self-consistency caller reuses the same
# engine unchanged.
#
# Assumption worth flagging: LengthFinishReasonError/ContentFilterFinishReasonError
# are raised by the SDK from inside .parse() itself, before any choice can be
# inspected individually — so unlike a per-choice refusal or token mismatch,
# either of those aborts the ENTIRE batch, not just one sample. Not yet
# confirmed against a real n>1 response that actually hits this path.
def _mark_samples(question, essay, rubric, expected_token, max_score, exemplars, temperature, n, other_questions=None):
    user_prompt = build_user_prompt(question, essay, rubric, exemplars=exemplars, other_questions=other_questions)

    try:
        response = client.chat.completions.parse(
            model="gpt-4o",
            temperature=temperature,
            n=n,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt}
            ],
            response_format=MarkingResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e

    results_list = []
    last_error = None

    for choice in response.choices:
        message = choice.message

        if message.refusal:
            log_marking_refusal(message.refusal)
            last_error = f"Model refused to mark student response: {message.refusal}"
            continue

        result = message.parsed
        if result is None:
            log_marking_empty()
            last_error = "No parsed result, refusal, truncation, or content-filter signal was returned"
            continue

        try:
            verify_token(expected_token, result.delimiter_token)
        except TokenMismatchError as e:
            last_error = str(e)
            continue

        results = result.model_dump(exclude={"delimiter_token"})

        detected_max = results.get("max_score_detected") or max_score
        breakdown = results.get("rubric_breakdown", [])
        results["score"] = min(
            sum(min(ao.get("score_awarded", 0), ao.get("max_marks", detected_max)) for ao in breakdown),
            detected_max
        )
        results["maxScore"] = detected_max

        # Cross-check against what extraction already determined for this
        # specific question — catches the marking-time model misreading or
        # miscalculating even when handed the correct number. Narrower than
        # an extraction-time misread (main.py's _check_scheme_consistency
        # catches that instead) since this only re-reads the already-
        # extracted JSON, not the original document — see the plan notes on
        # why the two aren't as independent as they first sound.
        try:
            scheme = json.loads(rubric)
        except Exception:
            scheme = {}

        extracted_marks = scheme.get("marks")
        if extracted_marks is not None and extracted_marks != detected_max:
            log_marking_scheme_mismatch(extracted_marks, detected_max)
            results["teacher_review_required"] = True

        # Completeness check: every AO the mark scheme lists must appear as
        # its own rubric_breakdown entry — the evidence check below only
        # validates what already made it into breakdown, not what's missing
        # from it entirely. "General" (points-based schemes with no real
        # AOs) is skipped — it's a placeholder meaning "no real AOs," not a
        # code the prompt tells the model to echo back verbatim.
        scheme_aos      = [ao.get("ao", "") for ao in scheme.get("assessment_objectives", []) if ao.get("ao")]
        is_general_only = len(scheme_aos) == 1 and _normalize_ao(scheme_aos[0]) == "general"

        missing_aos = []
        if scheme_aos and not is_general_only:
            returned_aos = {_normalize_ao(ao.get("criterion", "")) for ao in breakdown}
            missing_aos  = [ao for ao in scheme_aos if _normalize_ao(ao) not in returned_aos]
            if missing_aos:
                log_marking_missing_aos(missing_aos)
                results["teacher_review_required"] = True
        results["missing_aos"] = missing_aos

        # Deterministic safety net: every AO must carry at least one piece of
        # evidence, or this specific sample gets flagged for teacher review —
        # a measured signal (the model didn't do its job properly this time),
        # not a guess about confidence.
        if not breakdown or any(not ao.get("evidence") for ao in breakdown):
            results["teacher_review_required"] = True

        results_list.append(results)

    return results_list, last_error


def generate_llm_response(question, essay, rubric, expected_token, max_score=6, exemplars=None, other_questions=None):
    results_list, last_error = _mark_samples(question, essay, rubric, expected_token, max_score, exemplars, temperature=0.0, n=1, other_questions=other_questions)
    if not results_list:
        raise ValueError(last_error)
    return results_list[0]


# Marks the same essay n_samples times (temperature=0.5 — genuine diversity
# between samples, unlike the single-call path's 0.0, which barely varies)
# and turns how much the scores actually DISAGREE into a real, measured
# confidence number — replacing the model's self-reported guess about its
# own confidence with something grounded in observed behaviour.
#
# The qualitative content shown to the teacher (strengths, evidence, feedback)
# all comes from ONE sample — the median-scored one — never blended across
# samples. Only the score itself is a vote across all of them.
def generate_llm_response_consistent(
    question, essay, rubric, expected_token, max_score=6, exemplars=None,
    other_questions=None, n_samples=3, temperature=0.5,
):
    results_list, last_error = _mark_samples(
        question, essay, rubric, expected_token, max_score, exemplars,
        temperature=temperature, n=n_samples, other_questions=other_questions,
    )
    if not results_list:
        raise ValueError(last_error)

    # Only one sample survived (refusal/truncation/mismatch took the rest) —
    # nothing to compare against, so there's no spread to measure. Flag for
    # review rather than silently presenting a single unverified sample as
    # if it had been checked.
    if len(results_list) == 1:
        result = dict(results_list[0])
        result["teacher_review_required"] = True
        result["confidence"] = None
        result["score_spread"] = None
        return result

    sorted_by_score = sorted(results_list, key=lambda r: r["score"])
    scores = [r["score"] for r in sorted_by_score]
    spread = max(scores) - min(scores)
    detected_max = sorted_by_score[len(sorted_by_score) // 2].get("maxScore") or max_score
    confidence = max(0.0, min(1.0, 1 - (spread / detected_max))) if detected_max else 0.0

    if len(results_list) == 2:
        # No true median with only two samples — take the lower (more
        # conservative) score as the representative, and always flag for
        # review since a same-essay disagreement this small a sample can't
        # confirm is genuine noise vs one bad sample.
        representative = dict(sorted_by_score[0])
        representative["teacher_review_required"] = True
    else:
        mid = len(sorted_by_score) // 2
        representative = dict(sorted_by_score[mid])
        representative["teacher_review_required"] = (
            confidence < 0.85 or representative.get("teacher_review_required", False)
        )

    # A safety flag, not a scoring nuance — if ANY sample raised it, it wins,
    # rather than getting outvoted by samples that happened not to notice.
    mismatched = [r for r in results_list if r.get("question_mismatch")]
    representative["question_mismatch"] = bool(mismatched)
    if mismatched and not representative.get("question_mismatch_reason"):
        representative["question_mismatch_reason"] = mismatched[0].get("question_mismatch_reason")

    # Same rationale as question_mismatch above: a dropped AO is a
    # structural safety signal, not a scoring nuance that should get
    # outvoted just because the chosen representative sample happened not
    # to drop it.
    seen, all_missing = set(), []
    for r in results_list:
        for ao in r.get("missing_aos") or []:
            key = _normalize_ao(ao)
            if key not in seen:
                seen.add(key)
                all_missing.append(ao)
    representative["missing_aos"] = all_missing
    if all_missing:
        representative["teacher_review_required"] = True

    representative["confidence"] = confidence
    representative["score_spread"] = spread
    return representative