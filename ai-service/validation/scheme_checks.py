"""Run the descriptor checks one question at a time.

The checks used to run over the whole paper, so one band in one question
that failed made /ocr reject the entire mark scheme -- 42 of 62 real schemes
were unusable that way, though most of their questions were fine. Each
question is now checked on its own: a question that fails is left out of the
scheme and listed in ``skipped_questions`` with the reason, and the rest of
the paper stays usable. Only if no question survives is the upload rejected,
as before.

Order per question is unchanged: boundary check, content integrity, then
deterministic descriptor IDs.
"""

from typing import Any, Callable

from llm_service import DescriptorContentIntegrityError, DescriptorValidationError
from validation.descriptor_id_enrichment import add_descriptor_ids
from validation.descriptor_integrity_validation import validate_descriptor_content_integrity
from validation.descriptor_validation import validate_descriptor_shapes

_REASONS = {
    "shape": "its descriptor points could not be separated reliably",
    "content": "its descriptor text did not survive extraction word for word",
    "ids": "its levels could not be numbered",
}


def check_questions(
    structured_scheme: dict[str, Any],
    log_issues: Callable[[list], None] = lambda issues: None,
) -> dict[str, Any]:
    """The scheme with only the questions that passed every check (with
    descriptor IDs added), plus ``skipped_questions``: [{question_number,
    reason}]. Raises if no question passes."""
    questions = structured_scheme.get("questions")
    if not isinstance(questions, list):
        questions = []
    kept, skipped = [], []
    first_failure = None
    for question in questions:
        single = {**structured_scheme, "questions": [question]}
        failure = None
        shape_issues = validate_descriptor_shapes(single)
        if shape_issues:
            log_issues(shape_issues)
            failure = "shape"
        else:
            content_issues = validate_descriptor_content_integrity(single)
            if content_issues:
                log_issues(content_issues)
                failure = "content"
            else:
                single, id_issues = add_descriptor_ids(single)
                if id_issues:
                    log_issues(id_issues)
                    failure = "ids"
        if failure:
            first_failure = first_failure or failure
            number = question.get("question_number") if isinstance(question, dict) else None
            skipped.append({"question_number": number, "reason": _REASONS[failure]})
        else:
            kept.extend(single["questions"])

    if questions and not kept:
        if first_failure == "content":
            raise DescriptorContentIntegrityError("Extracted descriptor content did not match the raw descriptor")
        raise DescriptorValidationError("No question in the mark scheme passed the descriptor checks")
    return {**structured_scheme, "questions": kept, "skipped_questions": skipped}
