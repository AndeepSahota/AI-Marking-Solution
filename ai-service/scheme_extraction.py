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
extracted once more before being skipped. A question whose extracted grid
does not match its outline marks (the model returned another question's
grid) is also extracted once more, then skipped with that reason.

On long papers (many questions x a long text, e.g. Edexcel Literature at
70-123 pages) every call re-reading the whole scheme cost $3-6 per upload.
There, each question gets only its own section plus the shared sections the
outline says apply to it (a grid printed once for several questions, e.g.
AQA Literature's "Section A: Questions 01-24" grid), placed before its own
section as on the paper; a question whose section cannot be found reliably
still gets the whole text. If a question given only its section fails the
wrong-question guard, its second attempt reads the whole paper. Shorter
papers -- every Language paper, and the AO4 scheme -- keep the whole text.

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
from validation.band_levels import is_points_objective, mark_range
from validation.scheme_checks import CONTENT_REASON, check_questions

_FAILED = "it could not be extracted from the mark scheme"
# Questions x characters above which each question sees only its section:
# every Language paper measured is under 1.5M, long Literature papers 1.4-26M.
_LONG_PAPER = 2_000_000
_MIN_SECTION_CHARS = 300  # a shorter "section" means the start was found in the wrong place
_WRONG_GRID = "the mark grid found for it did not match its marks, so it may belong to another question"


def _unique_numbers(numbers: list[str]) -> list[str]:
    """Question numbers must be unique -- threads are stored by number."""
    seen, unique = {}, []
    for number in numbers:
        number = (number or "").strip() or "Question"
        seen[number] = seen.get(number, 0) + 1
        unique.append(number if seen[number] == 1 else f"{number} ({seen[number]})")
    return unique


def _alnum_with_map(text: str) -> tuple[str, list[int]]:
    """Lower-case letters and digits only, with each one's index in text --
    so a section start matches whatever bold marks, pipes or spacing the
    OCR put around it."""
    chars, index = [], []
    for i, ch in enumerate(text):
        if ch.isalnum():
            chars.append(ch.casefold())
            index.append(i)
    return "".join(chars), index


def _number_key(number) -> str:
    return _alnum_with_map(str(number or ""))[0]


def _applies(section: dict, item: dict, all_keys: set) -> bool:
    """Whether a shared section is for this question. A section whose
    applies_to names no outline question at all is given to every question
    (the safe old behaviour) rather than to none."""
    wanted = {_number_key(n) for n in section.get("applies_to") or []} & all_keys
    if not wanted:
        return True
    return bool({_number_key(item["question_number"]), _number_key(item.get("printed_number"))} & wanted)


def question_texts(clean_text: str, items: list[dict], shared: list[dict]) -> dict[str, str]:
    """{question_number: the text that question's extraction call sees}."""
    if len(items) * len(clean_text) < _LONG_PAPER:
        return {item["question_number"]: clean_text for item in items}
    squashed, index = _alnum_with_map(clean_text)

    def find(phrase, after=0):
        needle = _alnum_with_map(phrase or "")[0]
        if len(needle) < 8:  # too short to place reliably
            return None
        at = squashed.find(needle, after)
        return at if at >= 0 else None

    starts, cursor = {}, 0
    for item in items:  # in order, so a contents list near the front is passed over
        at = find(item.get("section_start"), cursor)
        if at is not None:
            starts[item["question_number"]] = at
            cursor = at + 1
    # Two grids can begin with the same words ("Level 6 Convincing, critical
    # analysis..." heads both AQA Literature Section A and B grids): a start
    # already taken moves on to its next occurrence.
    shared_at, taken = [], set(starts.values())
    for section in shared:
        at = find(section.get("section_start"))
        while at is not None and at in taken:
            at = find(section.get("section_start"), at + 1)
        if at is not None:
            taken.add(at)
        shared_at.append(at)
    boundaries = sorted(taken)

    def section(at):
        later = [b for b in boundaries if b > at]
        end = index[later[0]] if later else len(clean_text)
        return clean_text[index[at]:end]

    all_keys = {_number_key(item["question_number"]) for item in items} | \
               {_number_key(item.get("printed_number")) for item in items}
    texts, shared_counts = {}, []
    for item in items:
        number = item["question_number"]
        own = section(starts[number]) if number in starts else ""
        if len(own) < _MIN_SECTION_CHARS:
            texts[number] = clean_text
            continue
        mine = sorted(at for at, part in zip(shared_at, shared) if at is not None and _applies(part, item, all_keys))
        shared_counts.append(len(mine))
        texts[number] = "\n\n".join([section(at) for at in mine] + [own])
    whole = sum(text is clean_text for text in texts.values())
    print(f"[SCHEME EXTRACTION] long paper: {len(items) - whole} questions get their own section, "
          f"{whole} the whole text; {sum(at is not None for at in shared_at)} of {len(shared)} shared sections found, "
          f"{min(shared_counts, default=0)}-{max(shared_counts, default=0)} per question", flush=True)
    return texts


def _grid_mark_readings(question: dict) -> set[int]:
    """The question's total marks as its own grid reads -- several readings,
    since a shared grid is often repeated under each AO: the sum of each AO's
    top mark, the largest AO, the sum of distinct grids, and the sum of the
    AOs' stated marks. Empty if no reading is possible."""
    tops, grids, stated = [], {}, []
    for objective in question.get("assessment_objectives") or []:
        if isinstance(objective.get("marks_available"), int):
            stated.append(objective["marks_available"])
        if is_points_objective(objective):
            if isinstance(objective.get("marks_available"), int):
                tops.append(objective["marks_available"])
            continue
        ranges = [r for r in (mark_range(band.get("marks")) for band in objective.get("bands") or []) if r]
        if ranges:
            top = max(high for _, high in ranges)
            tops.append(top)
            grids[tuple(sorted(ranges))] = top
    if not tops:
        return set()
    return {sum(tops), max(tops), sum(grids.values()), sum(stated)} - {0}


def _marks_match(question: dict, outline_marks) -> bool:
    """The wrong-question guard: asked for one question, the model sometimes
    returns another's grid (AQA's 20-mark reading Q4 came back with the 40-mark
    writing grid). True unless the grid clearly disagrees with the outline."""
    readings = _grid_mark_readings(question)
    return not readings or not isinstance(outline_marks, int) or outline_marks in readings


def _extract_one(text: str, item: dict, all_numbers: list[str], whole_text: str | None = None):
    """(question, None) or (None, reason). A question whose grid does not
    match its outline marks is extracted once more, then skipped. If the
    first attempt saw only the question's section, the second reads the
    whole paper -- the section may have missed the grid it needs."""
    for attempt in (1, 2):
        if attempt == 2 and whole_text and text is not whole_text:
            text = whole_text
            print(f"[SCHEME EXTRACTION] {item['question_number']}: retrying with the whole paper", flush=True)
        wrapped, token = ms_ocr_sanitisation.wrap_for_prompt(text)
        try:
            question = extract_mark_scheme_question(
                wrapped, token, item["question_number"], item["marks"], item["description"], all_numbers
            )
        except (ExtractionError, ms_ocr_sanitisation.TokenMismatchError) as error:
            print(f"[SCHEME EXTRACTION] {item['question_number']}: {type(error).__name__}", flush=True)
            return None, _FAILED
        question["question_number"] = item["question_number"]  # the outline's (unique) number
        if _marks_match(question, item["marks"]):
            return question, None
        print(f"[SCHEME EXTRACTION] {item['question_number']}: grid marks {sorted(_grid_mark_readings(question))} "
              f"!= {item['marks']} (attempt {attempt})", flush=True)
    return None, _WRONG_GRID


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
        item["printed_number"] = item["question_number"]  # what applies_to uses
        item["question_number"] = number

    texts = question_texts(clean_text, items, outline.get("shared_sections") or [])
    for item in items:
        item["text"] = texts[item["question_number"]]
    results = run_calls([functools.partial(_extract_one, item["text"], item, numbers, clean_text) for item in items])
    questions = [question for question, _ in results if question is not None]
    skipped = [{"question_number": item["question_number"], "reason": reason}
               for item, (question, reason) in zip(items, results) if question is None]
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
    first = check_questions(structured, log_issues=log_issues, raise_if_empty=False, source_text=clean_text)
    retry_numbers = {s["question_number"] for s in first["skipped_questions"] if s["reason"] == CONTENT_REASON}
    kept, skipped = first["questions"], [s for s in first["skipped_questions"] if s["question_number"] not in retry_numbers]
    if retry_numbers:
        numbers = [item["question_number"] for item in items]
        retry_items = [item for item in items if item["question_number"] in retry_numbers]
        results = run_calls([functools.partial(_extract_one, item["text"], item, numbers, clean_text) for item in retry_items])
        again = [q for q, _ in results if q is not None]
        skipped += [{"question_number": item["question_number"], "reason": reason}
                    for item, (q, reason) in zip(retry_items, results) if q is None]
        second = check_questions({**structured, "questions": again, "skipped_questions": []},
                                 log_issues=log_issues, raise_if_empty=False, source_text=clean_text)
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


def _has_threads(question: dict) -> bool:
    return any((objective or {}).get("threads") for objective in (question.get("assessment_objectives") or {}).values())


def describe_threads_by_question(thread_input: dict) -> dict:
    """The thread split, one question per call, merged into one thread
    scheme. A question with no threads (a points question) needs no call:
    it is passed through as it is -- asking the model to describe nothing
    ran to the output limit on all 10 points questions in the hold-out run.
    A question whose split fails is just absent from the result."""
    entries = list((thread_input.get("questions") or {}).items())
    to_describe = [(key, question) for key, question in entries if _has_threads(question)]
    results = run_calls([functools.partial(_describe_one, key, question) for key, question in to_describe])
    described = {}
    for result in results:
        if result is not None:
            described.update(result)
    merged = {}
    for key, question in entries:  # source order
        if not _has_threads(question):
            merged[key] = question
        elif key in described:
            merged[key] = described[key]
    return {"questions": merged}
