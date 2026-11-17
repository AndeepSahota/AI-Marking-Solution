"""Structure a mark scheme one question at a time.

Asking for the whole paper in one reply failed on real schemes in two ways:
long papers hit the 16,384-token output limit (7 of 62), and medium ones
came back silently abridged -- only Question 1 or Section A, no error
(17 of 62). Instead:

1. an outline call lists every question (number as printed, marks, a short
   description), each listed separately even when questions share a grid;
2. one extraction call per question, in parallel, each seeing the whole
   scheme (so a grid printed once still applies) and returning only its
   question -- a small reply that cannot be truncated or abridged.

A question whose descriptor text does not survive word for word is
extracted once more before being skipped -- on Edexcel writing grids the
model sometimes reads the wrong part of the table.

The thread split runs per question too. A question whose extraction fails
is left out and listed in ``skipped_questions`` instead of failing the
paper; one whose thread split fails is kept (the old pipeline can still mark
it) and logged. Every call wraps the text with its own fresh anti-injection
token.
"""

import functools
import json
from typing import Any

from llm_service import (
    DescriptorContentIntegrityError,
    DescriptorValidationError,
    ExtractionError,
    ExtractionIncompleteError,
    extract_mark_scheme_question,
    extract_question_outline,
    generate_thread_description_response,
)
from security import ms_ocr_sanitisation
from specialists.parallel import run_calls
from validation.scheme_checks import CONTENT_REASON, check_questions

_FAILED = "it could not be extracted from the mark scheme"


def _unique_numbers(numbers: list[str]) -> list[str]:
    """Question numbers must be unique -- threads are stored by number."""
    seen, unique = {}, []
    for number in numbers:
        number = (number or "").strip() or "Question"
        seen[number] = seen.get(number, 0) + 1
        unique.append(number if seen[number] == 1 else f"{number} ({seen[number]})")
    return unique


def _extract_one(clean_text: str, item: dict, all_numbers: list[str]):
    wrapped, token = ms_ocr_sanitisation.wrap_for_prompt(clean_text)
    try:
        question = extract_mark_scheme_question(
            wrapped, token, item["question_number"], item["marks"], item["description"], all_numbers
        )
    except (ExtractionError, ms_ocr_sanitisation.TokenMismatchError) as error:
        print(f"[SCHEME EXTRACTION] {item['question_number']}: {type(error).__name__}", flush=True)
        return None
    question["question_number"] = item["question_number"]  # the outline's (unique) number
    return question


def extract_mark_scheme_by_question(clean_text: str) -> dict[str, Any]:
    """Same shape as llm_service.extract_mark_scheme(), plus
    ``skipped_questions`` for questions that could not be extracted."""
    wrapped, token = ms_ocr_sanitisation.wrap_for_prompt(clean_text)
    outline = extract_question_outline(wrapped, token)
    items = outline.get("questions") or []
    if not items:
        raise ExtractionIncompleteError("No questions were found in the mark scheme")
    numbers = _unique_numbers([item["question_number"] for item in items])
    for item, number in zip(items, numbers):
        item["question_number"] = number

    results = run_calls([functools.partial(_extract_one, clean_text, item, numbers) for item in items])
    questions = [question for question in results if question is not None]
    skipped = [{"question_number": item["question_number"], "reason": _FAILED}
               for item, question in zip(items, results) if question is None]
    if not questions:
        raise ExtractionIncompleteError("No question in the mark scheme could be extracted")
    return {
        "paper_type": "multi" if len(items) > 1 else "single",
        "total_marks": outline.get("total_marks"),
        "questions": questions,
        "skipped_questions": skipped,
        "outline_questions": items,  # internal: what a retry needs; dropped by extract_checked_scheme
    }


def extract_checked_scheme(clean_text: str, log_issues=lambda issues: None) -> dict[str, Any]:
    """Per-question extraction plus the per-question descriptor checks
    (validation/scheme_checks.py), retrying once any question whose text did
    not survive word for word. Raises if no question passes."""
    structured = extract_mark_scheme_by_question(clean_text)
    items = structured.pop("outline_questions")
    first = check_questions(structured, log_issues=log_issues, raise_if_empty=False)
    retry_numbers = {s["question_number"] for s in first["skipped_questions"] if s["reason"] == CONTENT_REASON}
    kept, skipped = first["questions"], [s for s in first["skipped_questions"] if s["question_number"] not in retry_numbers]
    if retry_numbers:
        numbers = [item["question_number"] for item in items]
        retry_items = [item for item in items if item["question_number"] in retry_numbers]
        results = run_calls([functools.partial(_extract_one, clean_text, item, numbers) for item in retry_items])
        again = [q for q in results if q is not None]
        skipped += [{"question_number": item["question_number"], "reason": _FAILED}
                    for item, q in zip(retry_items, results) if q is None]
        second = check_questions({**structured, "questions": again, "skipped_questions": []},
                                 log_issues=log_issues, raise_if_empty=False)
        kept += second["questions"]
        skipped += second["skipped_questions"]
        order = {number: i for i, number in enumerate(numbers)}
        kept.sort(key=lambda q: order.get(q.get("question_number"), len(order)))
    if not kept:
        if all(s["reason"] == CONTENT_REASON for s in skipped):
            raise DescriptorContentIntegrityError("Extracted descriptor content did not match the raw descriptor")
        raise DescriptorValidationError("No question in the mark scheme passed the descriptor checks")
    return {**structured, "questions": kept, "skipped_questions": skipped}


def _describe_one(question_key: str, question: dict):
    text = json.dumps({"questions": {question_key: question}}, ensure_ascii=False)
    text, _ = ms_ocr_sanitisation.strip_delimiter_like_patterns(text)
    wrapped, token = ms_ocr_sanitisation.wrap_for_prompt(text)
    try:
        return generate_thread_description_response(wrapped, token)["questions"]
    except (ExtractionError, ms_ocr_sanitisation.TokenMismatchError) as error:
        print(f"[THREAD SPLIT] {question_key}: {type(error).__name__}", flush=True)
        return None


def describe_threads_by_question(thread_input: dict) -> dict:
    """The thread split, one question per call, merged into one thread
    scheme. A question whose split fails is just absent from it."""
    entries = list((thread_input.get("questions") or {}).items())
    results = run_calls([functools.partial(_describe_one, key, question) for key, question in entries])
    merged = {}
    for result in results:
        if result is not None:
            merged.update(result)
    return {"questions": merged}
