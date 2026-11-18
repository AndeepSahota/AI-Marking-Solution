"""Run the descriptor checks one question at a time.

The checks used to run over the whole paper, so one band in one question
that failed made /ocr reject the entire mark scheme -- 42 of 62 real schemes
were unusable that way, though most of their questions were fine. Each
question is now checked on its own: a question that fails is left out of the
scheme and listed in ``skipped_questions`` with the reason, and the rest of
the paper stays usable. Only if no question survives is the upload rejected,
as before.

Per question: boundary check, content integrity, then deterministic
descriptor IDs. The boundary (shape) check is logged but does not skip a
question: descriptor IDs are built from the application's own split of the
raw text, not the model's list, and the content check still requires the
words to survive intact -- requiring the model to split a bulleted cell
exactly like the parser rejected good questions whenever a cell held a
heading such as "Content" (17 of 62 real schemes).
"""

from typing import Any, Callable

from llm_service import DescriptorContentIntegrityError, DescriptorValidationError
from validation.descriptor_id_enrichment import add_descriptor_ids
from validation.descriptor_integrity_validation import validate_descriptor_content_integrity
from validation.descriptor_validation import validate_descriptor_shapes
from validation.heading_repair import remove_dropped_headings
from validation.source_anchor import anchor_bands_to_source

CONTENT_REASON = "its descriptor text did not survive extraction word for word"
_REASONS = {
    "content": CONTENT_REASON,
    "ids": "its levels could not be numbered",
    "duplicate_ids": "two of its bands share a level number",
}


def _has_duplicate_ids(question: dict) -> bool:
    """Two bands numbered the same (e.g. "Upper Level 4" and "Lower Level 4",
    or two AOs that normalise to one ID prefix) give repeated descriptor IDs,
    which the thread split cannot place."""
    seen = set()
    for objective in question.get("assessment_objectives") or []:
        for band in (objective.get("bands") or []) if isinstance(objective, dict) else []:
            for item in band.get("descriptors") or [] if isinstance(band, dict) else []:
                descriptor_id = item.get("id") if isinstance(item, dict) else None
                if descriptor_id is None:
                    continue
                if descriptor_id in seen:
                    return True
                seen.add(descriptor_id)
    return False


def check_questions(
    structured_scheme: dict[str, Any],
    log_issues: Callable[[list], None] = lambda issues: None,
    raise_if_empty: bool = True,
    source_text: str = "",
) -> dict[str, Any]:
    """The scheme with only the questions that passed every check (with
    descriptor IDs added), plus ``skipped_questions``: [{question_number,
    reason}]. Raises if no question passes, unless raise_if_empty is False.
    source_text: the scheme's OCR text, for bands whose points must be
    checked against it (validation/source_anchor.py)."""
    questions = structured_scheme.get("questions")
    if not isinstance(questions, list):
        questions = []
    kept = []
    skipped = list(structured_scheme.get("skipped_questions") or [])  # e.g. from extraction
    first_failure = None
    for question in questions:
        single = {**structured_scheme, "questions": [question]}
        failure = None
        shape_issues = validate_descriptor_shapes(single)
        if shape_issues:
            log_issues(shape_issues)  # advisory only -- see the module docstring
        content_issues = validate_descriptor_content_integrity(single)
        if content_issues:
            # Headings the model dropped from the points but left in the
            # descriptor text are removed, then checked again
            # (validation/heading_repair.py).
            repaired = {**single, "questions": [remove_dropped_headings(question)]}
            remaining = validate_descriptor_content_integrity(repaired)
            if not remaining:
                single, content_issues = repaired, []
            else:
                # Otherwise accept the failing bands if every point is copied
                # word for word from the scheme (validation/source_anchor.py).
                failing = {(issue.get("ao"), issue.get("band")) for issue in remaining}
                anchored = anchor_bands_to_source(repaired["questions"][0], failing, source_text)
                if anchored is not None:
                    candidate = {**single, "questions": [anchored]}
                    if not validate_descriptor_content_integrity(candidate):
                        single, content_issues = candidate, []
        if content_issues:
            log_issues(content_issues)
            failure = "content"
        else:
            single, id_issues = add_descriptor_ids(single)
            if id_issues:
                log_issues(id_issues)
                failure = "ids"
            elif _has_duplicate_ids(single["questions"][0]):
                failure = "duplicate_ids"
        if failure:
            first_failure = first_failure or failure
            number = question.get("question_number") if isinstance(question, dict) else None
            skipped.append({"question_number": number, "reason": _REASONS[failure]})
        else:
            kept.extend(single["questions"])

    if raise_if_empty and questions and not kept:
        if first_failure == "content":
            raise DescriptorContentIntegrityError("Extracted descriptor content did not match the raw descriptor")
        raise DescriptorValidationError("No question in the mark scheme passed the descriptor checks")
    return {**structured_scheme, "questions": kept, "skipped_questions": skipped}
