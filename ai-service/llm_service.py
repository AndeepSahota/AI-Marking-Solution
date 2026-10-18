import json
import os
from openai import OpenAI, OpenAIError, LengthFinishReasonError, ContentFilterFinishReasonError
from dotenv import load_dotenv
from prompts import SYSTEM_PROMPT, build_user_prompt, EXTRACTION_SYSTEM_PROMPT, build_extraction_prompt
from segmentation.seg_prompt import SYSTEM_PROMPT as SEGMENTATION_SYSTEM_PROMPT, build_segmentation_user_prompt
from aggregation.aggregation_prompt import (
    SYSTEM_PROMPT as AGGREGATION_SYSTEM_PROMPT,
    build_aggregation_user_prompt,
)
from transformations.thread_description_prompt import (
    SYSTEM_PROMPT as THREAD_DESCRIPTION_SYSTEM_PROMPT,
    build_thread_description_prompt,
)
from transformations.fm_descriptor_to_thread import fm_descriptor_to_thread
from security.ms_ocr_sanitisation import verify_token
from schemas.ms_schema import MarkSchemeExtraction
from schemas.marking_result_schema import MarkingResult
from schemas.segmented_result import SegmentationResult
from schemas.aggregation_schema import AggregationResult
from schemas.final_marking_result import FinalMarkingResult
from final_marking.final_prompt import (
    SYSTEM_PROMPT as FINAL_MARKING_SYSTEM_PROMPT,
    build_final_marking_user_prompt,
)
from final_marking.context import reconcile_final_score, resolve_final_marking_result
from specialists.thread_specialist_prompt import (
    SYSTEM_PROMPT as THREAD_SPECIALIST_SYSTEM_PROMPT,
    build_thread_specialist_user_prompt,
)
from specialists.thread_a_ideas_prompt import (
    SYSTEM_PROMPT as IDEA_SPECIALIST_SYSTEM_PROMPT,
    build_idea_specialist_user_prompt,
)
from specialists.thread_c_references_prompt import (
    SYSTEM_PROMPT as REFERENCE_SPECIALIST_SYSTEM_PROMPT,
    build_reference_specialist_user_prompt,
)
from specialists.thread_b_judgement_prompt import (
    SYSTEM_PROMPT as JUDGEMENT_SPECIALIST_SYSTEM_PROMPT,
    build_judgement_specialist_user_prompt,
)
from schemas.thread_specialist_result import ThreadSpecialistResult, ThreadStepResult, ReferenceStepResult
from specialists.steps import resolve_level_from_steps, resolve_reference_level_from_steps
from schemas.thread_description_result import ThreadDescriptionResult
from observability.event_log import (
    log_extraction_refusal,
    log_extraction_truncated,
    log_extraction_filtered,
    log_extraction_empty,
    log_marking_refusal,
    log_marking_truncated,
    log_marking_filtered,
    log_marking_empty,
)
from observability.raw_response_capture import save_raw_final_marking_response

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
    .parsed is touched at all. Left uncaught by the caller, same as
    TokenMismatchError: a refusal means there is no result to trust, so the
    request should fail rather than return something absent or partial."""
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


class FinalMarkingValidationError(ExtractionError):
    """Carries a parsed, token-verified final-marking response that failed
    application validation so it can be retained for diagnosis."""

    def __init__(self, message, model_result):
        super().__init__(message)
        self.model_result = model_result


class DescriptorValidationError(ExtractionError):
    """Raised when extracted descriptor bullets cannot be verified safely."""
    pass


class DescriptorContentIntegrityError(DescriptorValidationError):
    """Raised when descriptor-list content differs from its raw descriptor."""
    pass

# This line reads the .env file and loads the variables in the enviroment 
# Without this, python has no idea my API key exists 
load_dotenv()

# This creates the OpenAI client object 
# It automatically looks for OPEN_AI_KEY in your enviroment variables 
# This is why the key is never hardcoded - it is pulled securly from .env
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Model for the per-thread specialists only -- every other stage keeps its own
# model. Configurable so a newer model can be trialled against the same
# prompts without touching the rest of the pipeline.
SPECIALIST_MODEL = os.getenv("SPECIALIST_MODEL", "gpt-4o")
SPECIALIST_REASONING_EFFORT = os.getenv("SPECIALIST_REASONING_EFFORT", "")


def _specialist_model_kwargs(temperature):
    """gpt-4o takes a temperature; reasoning models (e.g. gpt-6-luna) reject
    any temperature but the default and take a reasoning effort instead."""
    if SPECIALIST_MODEL.startswith("gpt-4o"):
        return {"model": SPECIALIST_MODEL, "temperature": temperature}
    kwargs = {"model": SPECIALIST_MODEL}
    if SPECIALIST_REASONING_EFFORT:
        kwargs["reasoning_effort"] = SPECIALIST_REASONING_EFFORT
    return kwargs


def _response_performance(response):
    """Extract provider telemetry without changing normal application output."""
    usage = getattr(response, "usage", None)
    choice = response.choices[0] if getattr(response, "choices", None) else None
    return {
        "model_returned": getattr(response, "model", None),
        "finish_reason": getattr(choice, "finish_reason", None),
        "prompt_tokens": getattr(usage, "prompt_tokens", None),
        "completion_tokens": getattr(usage, "completion_tokens", None),
        "total_tokens": getattr(usage, "total_tokens", None),
    }


def _marking_rubric_without_constraints(rubric):
    """Remove extraction-only constraints from the rubric sent to marking LLMs."""
    if isinstance(rubric, str):
        try:
            parsed_rubric = json.loads(rubric)
        except json.JSONDecodeError:
            return rubric
    elif isinstance(rubric, dict):
        parsed_rubric = rubric
    else:
        return rubric

    if not isinstance(parsed_rubric, dict):
        return rubric

    marking_rubric = dict(parsed_rubric)
    marking_rubric.pop("band_constraints", None)
    return json.dumps(marking_rubric, ensure_ascii=False)


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

    # Backstop: none of the checks above explain why, but there's still no
    # result. Fails loudly here with a clear reason instead of crashing a
    # few lines further down with an unrelated-looking AttributeError.
    if result is None:
        log_extraction_empty()
        raise ExtractionIncompleteError(
            "No parsed result, refusal, truncation, or content-filter signal was returned"
        )

    # delimiter_token is an integrity check, not part of the mark scheme
    # structure the rest of the app expects back. Raises TokenMismatchError
    # on failure, which the caller does not catch — a mismatch means we
    # can't trust this result reflects the genuine boundary, so the request
    # should fail rather than return something unverified.
    verify_token(expected_token, result.delimiter_token)

    structured_scheme = result.model_dump(exclude={"delimiter_token"})

    return structured_scheme


def generate_thread_description_response(scheme_text, expected_token):
    user_prompt = build_thread_description_prompt(scheme_text)

    try:
        response = client.chat.completions.parse(
            model="gpt-4o-mini",
            temperature=0.0,
            messages=[
                {"role": "system", "content": THREAD_DESCRIPTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=ThreadDescriptionResult,
        )
    except LengthFinishReasonError as e:
        log_extraction_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_extraction_filtered()
        raise ExtractionFilteredError(str(e)) from e

    message = response.choices[0].message
    if message.refusal:
        log_extraction_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_extraction_empty()
        raise ExtractionIncompleteError(
            "No parsed thread-description result, refusal, truncation, or "
            "content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)
    return _thread_description_lists_to_keyed_scheme(result)


def _thread_description_lists_to_keyed_scheme(result: ThreadDescriptionResult):
    """Restore the application's keyed thread-scheme shape after parsing the
    list-only Structured Outputs response required by OpenAI."""
    questions = {}

    for question in result.questions:
        assessment_objectives = {}

        for assessment_objective in question.assessment_objectives:
            threads = {
                thread.thread_key: {
                    "thread_id": thread.thread_id,
                    "thread_description": thread.thread_description,
                    "levels": [level.model_dump() for level in thread.levels],
                }
                for thread in assessment_objective.threads
            }

            assessment_objectives[assessment_objective.ao] = {
                "marks_available": assessment_objective.marks_available,
                "band_marks": [
                    band_mark.model_dump()
                    for band_mark in assessment_objective.band_marks
                ],
                "threads": threads,
            }

        questions[question.question] = {
            "marks_available": question.marks_available,
            "assessment_objectives": assessment_objectives,
        }

    return {"questions": questions}


def generate_llm_response(question, essay, rubric, expected_token, max_score=6, exemplars=None):
    marking_rubric = _marking_rubric_without_constraints(rubric)
    user_prompt = build_user_prompt(
        question,
        essay,
        marking_rubric,
        exemplars=exemplars,
    )

    # Structured Outputs + delimiter-token verification, same setup as
    # extract_mark_scheme() above: the SDK checks finish_reason itself and
    # raises these two directly from inside .parse() — they never reach the
    # .refusal check below, so they need their own try/except around the
    # call itself, not a field check on the response afterward.
    try:
        response = client.chat.completions.parse(
            model="gpt-4o",
            temperature=0.0,
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

    message = response.choices[0].message

    # A refusal does not populate .parsed — checked first, before anything
    # downstream assumes a result exists at all.
    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed

    # Backstop: none of the checks above explain why, but there's still no
    # result. Fails loudly here with a clear reason instead of crashing a
    # few lines further down with an unrelated-looking AttributeError.
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No parsed result, refusal, truncation, or content-filter signal was returned"
        )

    # delimiter_token is an integrity check, not part of the marking result
    # the rest of the app expects back. Raises TokenMismatchError on failure,
    # which the caller does not catch — a mismatch means we can't trust this
    # result reflects the genuine student-response boundary, so the request
    # should fail rather than return something unverified.
    verify_token(expected_token, result.delimiter_token)

    results = result.model_dump(exclude={"delimiter_token"})

    detected_max = results.get("max_score_detected") or max_score
    breakdown = results.get("rubric_breakdown", [])
    results["score"]    = min(
        sum(min(ao.get("score_awarded", 0), ao.get("max_marks", detected_max)) for ao in breakdown),
        detected_max
    )
    results["maxScore"] = detected_max

    return results


def generate_segmentation_response(
    question,
    essay,
    thread_extraction,
    assessment_objective_descriptions,
    expected_token,
    max_score=6,
    exemplars=None,
):
    del exemplars

    if thread_extraction is None or (
        isinstance(thread_extraction, str) and not thread_extraction.strip()
    ):
        raise ValueError(
            "Segmentation requires thread_extraction for the selected mark scheme"
        )

    try:
        selected_thread_extraction = (
            json.loads(thread_extraction)
            if isinstance(thread_extraction, str)
            else thread_extraction
        )
    except json.JSONDecodeError as e:
        raise ValueError(
            "Segmentation requires a valid JSON thread_extraction for the selected question"
        ) from e

    if not isinstance(selected_thread_extraction, dict):
        raise ValueError(
            "Segmentation requires a selected-question thread_extraction object"
        )

    if not isinstance(assessment_objective_descriptions, list) or not (
        assessment_objective_descriptions
    ):
        raise ValueError(
            "Segmentation requires assessment-objective descriptions from the selected question"
        )

    assessment_objectives = selected_thread_extraction.get("assessment_objectives")
    if not isinstance(assessment_objectives, dict) or not assessment_objectives:
        raise ValueError(
            "Segmentation requires assessment_objectives in the selected thread_extraction"
        )

    has_descriptor_thread = any(
        isinstance(assessment_objective, dict)
        and isinstance(assessment_objective.get("threads"), dict)
        and assessment_objective["threads"]
        for assessment_objective in assessment_objectives.values()
    )
    if not has_descriptor_thread:
        raise ValueError(
            "Segmentation requires at least one descriptor thread in the selected thread_extraction"
        )

    marks_available = selected_thread_extraction.get("marks_available")
    if not isinstance(marks_available, int):
        marks_available = max_score

    user_prompt = build_segmentation_user_prompt(
        question=question,
        marks_available=marks_available,
        assessment_objective_descriptions=json.dumps(
            assessment_objective_descriptions,
            ensure_ascii=False,
        ),
        thread_extraction=json.dumps(selected_thread_extraction, ensure_ascii=False),
        essay=essay,
    )

    try:
        response = client.chat.completions.parse(
            model="gpt-4o-mini",
            temperature=0.0,
            messages=[
                {"role": "system", "content": SEGMENTATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=SegmentationResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e

    message = response.choices[0].message

    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No segmentation result, refusal, truncation, or content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)

    return result.model_dump(exclude={"delimiter_token"})


def generate_aggregation_response(
    assessment_focus,
    student_response,
    extracted_result,
    mark_scheme_extraction,
    expected_token,
    include_performance=False,
):
    user_prompt = build_aggregation_user_prompt(
        assessment_focus=assessment_focus,
        student_response=student_response,
        extracted_result=extracted_result,
        mark_scheme_extraction=mark_scheme_extraction,
    )

    try:
        response = client.chat.completions.parse(
            model="gpt-4o-mini",
            temperature=0.0,
            messages=[
                {"role": "system", "content": AGGREGATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=AggregationResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e

    message = response.choices[0].message

    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No aggregation result, refusal, truncation, or content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)

    resolved = result.model_dump(exclude={"delimiter_token"})
    if include_performance:
        return resolved, _response_performance(response)
    return resolved


def generate_thread_specialist_response(
    question,
    student_response,
    thread_description,
    levels,
    expected_token,
    include_performance=False,
):
    """Judge ONE thread against the real student response directly.

    Deliberately given no visibility into the other threads for this AO, any
    other specialist's output, or any earlier stage's score -- independence
    is the entire design, not an oversight. Uses gpt-4o, not gpt-4o-mini:
    the same model final marking was moved to after testing showed the
    weaker tier underperformed on this kind of judgement.
    """
    user_prompt = build_thread_specialist_user_prompt(
        question=question,
        student_response=student_response,
        thread_description=thread_description,
        levels=levels,
    )

    try:
        response = client.chat.completions.parse(
            **_specialist_model_kwargs(0.0),
            messages=[
                {"role": "system", "content": THREAD_SPECIALIST_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=ThreadStepResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e
    except OpenAIError as e:
        raise ExtractionError("Thread specialist LLM request failed") from e

    message = response.choices[0].message

    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No thread specialist result, refusal, truncation, or content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)

    raw = result.model_dump(exclude={"delimiter_token"})
    resolved = resolve_level_from_steps(raw["steps"], levels, student_response)
    if include_performance:
        return resolved, _response_performance(response)
    return resolved


def generate_idea_specialist_response(
    question,
    student_response,
    thread_description,
    levels,
    expected_token,
    include_performance=False,
):
    """Same job as generate_thread_specialist_response, but for the
    "ideas, events, themes or settings" thread specifically -- uses a
    dedicated prompt built after diagnosing that this thread was wrongly
    crediting a quote plus an interpretive verb ("suggests"/"shows"/
    "creates") plus a label as a genuine comment, with nothing explaining
    why the detail produces that effect.

    Same output schema as the generic specialist (ThreadStepResult,
    reduced in code by the same resolve_level_from_steps) -- this version
    only changes the system prompt's instructions, asking the model to run
    four concrete checks (so-what, swap, effect-not-fact, does-it-build)
    before earning a step. An earlier attempt tried to verify this in code
    by counting new vocabulary in a split label/mechanism field, and it
    overcorrected badly -- a genuine explanation can legitimately reuse the
    quote's own words, so word-counting couldn't tell real reasoning apart
    from lazy repetition. This judgment is semantic, not lexical, so it
    stays a prompt-level judgment, same as thread B's checklist.

    Deliberately its own function and its own prompt file, not a branch in
    generate_thread_specialist_response: an earlier, different attempt
    added an equivalent rule to the prompt thread A and thread C share, and
    it measurably broke thread C, which was never diagnosed as having this
    problem. Thread C stays on generate_thread_specialist_response.
    """
    user_prompt = build_idea_specialist_user_prompt(
        question=question,
        student_response=student_response,
        thread_description=thread_description,
        levels=levels,
    )

    try:
        response = client.chat.completions.parse(
            **_specialist_model_kwargs(0.0),
            messages=[
                {"role": "system", "content": IDEA_SPECIALIST_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=ThreadStepResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e
    except OpenAIError as e:
        raise ExtractionError("Idea specialist LLM request failed") from e

    message = response.choices[0].message

    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No idea specialist result, refusal, truncation, or content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)

    raw = result.model_dump(exclude={"delimiter_token"})
    resolved = resolve_level_from_steps(raw["steps"], levels, student_response)
    if include_performance:
        return resolved, _response_performance(response)
    return resolved


def generate_reference_specialist_response(
    question,
    student_response,
    thread_description,
    levels,
    expected_token,
    include_performance=False,
):
    """Same job as generate_thread_specialist_response, but for the
    "reference selection and support" thread specifically -- uses a
    dedicated prompt built after diagnosing that this thread's step
    explanations kept echoing the level descriptor's own wording back as
    "proof" (e.g. "appropriate and relevant to the points being made",
    copied almost verbatim from the Level 3 text) instead of giving an
    independent reason tied to the actual quote. Suspected to be why this
    thread's answers flip between adjacent levels on repeated identical
    runs -- see scripts/thread_c_descriptor_echo_diagnosis.txt and
    scripts/thread_c_raw_response_1020.json for the real evidence.

    Different output schema from the generic specialist: ReferenceStepResult
    splits "explanation" into "what_student_does", "why_this_meets_criterion"
    (plain language, no descriptor vocabulary) and "descriptor_phrase_matched"
    (the only field allowed to contain it) -- resolve_reference_level_from_steps
    checks in code that the first two fields don't leak the descriptor's own
    words. Two earlier prompt-only attempts (a self-check instruction, then a
    blanket word ban) didn't hold up -- see specialists/steps.py.

    Deliberately its own function and its own prompt file, not a branch in
    generate_thread_specialist_response: thread A already moved to its own
    dedicated file for the same reason (a shared-file fix validated on one
    thread broke the other).
    """
    user_prompt = build_reference_specialist_user_prompt(
        question=question,
        student_response=student_response,
        thread_description=thread_description,
        levels=levels,
    )

    try:
        response = client.chat.completions.parse(
            **_specialist_model_kwargs(0.0),
            messages=[
                {"role": "system", "content": REFERENCE_SPECIALIST_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=ReferenceStepResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e
    except OpenAIError as e:
        raise ExtractionError("Reference specialist LLM request failed") from e

    message = response.choices[0].message

    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No reference specialist result, refusal, truncation, or content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)

    raw = result.model_dump(exclude={"delimiter_token"})
    resolved = resolve_reference_level_from_steps(raw["steps"], levels, student_response)
    if include_performance:
        return resolved, _response_performance(response)
    return resolved


def generate_judgement_specialist_response(
    question,
    student_response,
    thread_description,
    levels,
    expected_token,
    temperature=0.0,
    include_performance=False,
):
    """Same job as generate_thread_specialist_response, but for the
    "assertions and judgements" thread specifically -- uses the checklist
    + real-exemplar prompt built after diagnosing that this one thread was
    the overwhelming source of the Level 2 clustering found across 15 real
    essays (10/15, vs the other two threads' ~33-40%). Same output schema,
    different system prompt -- nothing downstream needs to know which one
    produced the result.

    temperature is a parameter (not hardcoded) so the self-consistency
    wrapper in specialists/consistency.py can request real sample diversity
    (0.5) for its ensembled calls, while a single direct call still
    defaults to the deterministic 0.0 used everywhere else in this
    pipeline.
    """
    user_prompt = build_judgement_specialist_user_prompt(
        question=question,
        student_response=student_response,
        thread_description=thread_description,
        levels=levels,
    )

    try:
        response = client.chat.completions.parse(
            **_specialist_model_kwargs(temperature),
            messages=[
                {"role": "system", "content": JUDGEMENT_SPECIALIST_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format=ThreadSpecialistResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e
    except OpenAIError as e:
        raise ExtractionError("Judgement specialist LLM request failed") from e

    message = response.choices[0].message

    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)

    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError(
            "No judgement specialist result, refusal, truncation, or content-filter signal was returned"
        )

    verify_token(expected_token, result.delimiter_token)

    resolved = result.model_dump(exclude={"delimiter_token"})
    if include_performance:
        return resolved, _response_performance(response)
    return resolved


def generate_final_marking_response(
    delimited_input,
    expected_token,
    context,
    include_performance=False,
):
    print("[FINAL MARKING] Sending evidence and scheme to the LLM", flush=True)
    try:
        response = client.chat.completions.parse(
            model="gpt-4o",
            temperature=0.0,
            messages=[
                {"role": "system", "content": FINAL_MARKING_SYSTEM_PROMPT},
                {"role": "user", "content": build_final_marking_user_prompt(delimited_input)},
            ],
            response_format=FinalMarkingResult,
        )
    except LengthFinishReasonError as e:
        log_marking_truncated(str(e))
        raise ExtractionTruncatedError(str(e)) from e
    except ContentFilterFinishReasonError as e:
        log_marking_filtered()
        raise ExtractionFilteredError(str(e)) from e
    except OpenAIError as e:
        raise ExtractionError("Final marking LLM request failed") from e
    except ValueError as e:
        raise ExtractionError("Invalid final marking response shape") from e

    message = response.choices[0].message
    save_raw_final_marking_response(
        getattr(message, "content", None),
        response_id=getattr(response, "id", None),
        model=getattr(response, "model", None),
        finish_reason=getattr(response.choices[0], "finish_reason", None),
    )
    if message.refusal:
        log_marking_refusal(message.refusal)
        raise ExtractionRefusedError(message.refusal)
    result = message.parsed
    if result is None:
        log_marking_empty()
        raise ExtractionIncompleteError("No final marking result was returned")

    verify_token(expected_token, result.delimiter_token)
    model_result = reconcile_final_score(result.model_dump(exclude={"delimiter_token"}))
    try:
        resolved = resolve_final_marking_result(model_result, context)
        resolved = fm_descriptor_to_thread(resolved, context)
    except ValueError as e:
        raise FinalMarkingValidationError(str(e), model_result) from e
    print("[FINAL MARKING] Response verified; evidence quotes and threads attached", flush=True)
    if include_performance:
        return resolved, _response_performance(response)
    return resolved
