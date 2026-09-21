"""Deterministic shape validation for extracted band descriptors.

The extraction model returns a complete, unseparated ``descriptor`` string and
an independently generated ``descriptors`` list. This module independently
splits the complete string and checks that the resulting source points match
the model list. It deliberately does not modify the extracted scheme or assign
IDs; those are separate later stages in the extraction pipeline.
"""

import re
import unicodedata
from typing import Any

from observability.event_log import log_descriptor_validation_comparison


DESCRIPTOR_LIST_MISMATCH = "descriptor_list_mismatch"

_INLINE_BULLET = re.compile(
    r"(?:[•▪◦●○*]\s*|(?<!\?\s)(?<!\S)[-–—]\s+|(?<!\S)(?:\d+|[A-Za-z])[.)]\s+|(?=\bNB:\s*))"
)
_LEADING_BULLET = re.compile(
    r"^\s*(?:[•▪◦●○*]|[-–—]|(?:\d+|[A-Za-z])[.)])\s+"
)
# Falls back to sentence boundaries when a band has no bullet markers at all —
# common in real AQA mark schemes, which often write each band as a short
# prose paragraph instead of a bulleted list. Deliberately conservative (only
# splits on ./!/? followed by whitespace and a capital letter or opening
# parenthesis) since this is a heuristic, not real sentence tokenisation — it
# will misfire on a genuine abbreviation, but that's rare in this text and
# preferable to the alternative of never splitting prose bands at all.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def split_descriptor_bullets(descriptor: str) -> list[str]:
    """Split a complete band descriptor into ordered source points.

    Bullet markers and ``NB:`` notes may appear at the start of a line or in a
    flattened OCR/LLM string. Text before the first marker is retained as its
    own source point, which preserves point-mark instructions such as
    ``Award 1 mark for:``. If no separator is present, the complete non-empty
    descriptor is one source point.
    """
    if not isinstance(descriptor, str):
        return []

    flattened = " ".join(descriptor.replace("\r\n", "\n").replace("\r", "\n").split())
    if not flattened:
        return []

    bullet_points = [
        point.strip()
        for point in _INLINE_BULLET.split(flattened)
        if point.strip()
    ]

    # No bullet markers found at all — the band is written as flowing prose.
    # Extraction still splits each distinct sentence into its own descriptor
    # point in that case (see the extraction prompt), so fall back to the
    # same split here rather than reporting "1 point" against the model's
    # several; otherwise every prose-style band fails validation outright.
    if len(bullet_points) <= 1:
        sentence_points = [
            point.strip()
            for point in _SENTENCE_BOUNDARY.split(flattened)
            if point.strip()
        ]
        if len(sentence_points) > 1:
            return sentence_points

    return bullet_points


def _has_bullet_markers(descriptor: str) -> bool:
    """Whether the source descriptor contains an actual bullet marker.

    Distinguishes a genuinely bulleted/numbered band (where the source itself
    unambiguously defines point boundaries) from flowing prose (where the
    sentence-boundary fallback in split_descriptor_bullets is only a guess).
    """
    if not isinstance(descriptor, str):
        return False
    flattened = " ".join(descriptor.replace("\r\n", "\n").replace("\r", "\n").split())
    return bool(_INLINE_BULLET.search(flattened))


def _normalise_for_comparison(value: str) -> str:
    """Normalise harmless OCR/presentation differences for list comparison."""
    normalised = unicodedata.normalize("NFKC", value).strip()
    normalised = _LEADING_BULLET.sub("", normalised)

    return " ".join(normalised.split()).casefold()


def is_general_assessment_objective(ao: object) -> bool:
    """Whether an AO is the point-mark sentinel with no band provenance."""
    return isinstance(ao, str) and ao.strip().casefold() == "general"


def _issue(
    *,
    rule: str,
    question_number: object,
    ao: object,
    band: object,
    descriptor: object,
    parsed_descriptors: list[str],
    model_descriptors: list[str],
    reason: str,
) -> dict[str, Any]:
    return {
        "rule": rule,
        "question_number": question_number,
        "ao": ao,
        "band": band,
        "descriptor": descriptor,
        "parsed_descriptors": parsed_descriptors,
        "model_descriptors": model_descriptors,
        "reason": reason,
    }


def validate_descriptor_shapes(
    structured_scheme: dict[str, Any],
) -> list[dict[str, Any]]:
    """Check model descriptor boundaries against source-derived boundaries.

    The supplied scheme is never modified. The caller is responsible for
    logging returned issues and preventing invalid data from being stored.
    """
    if not isinstance(structured_scheme, dict):
        raise TypeError("structured_scheme must be a dictionary")

    issues: list[dict[str, Any]] = []

    questions = structured_scheme.get("questions")
    if not isinstance(questions, list):
        return issues

    for question in questions:
        if not isinstance(question, dict):
            continue

        question_number = question.get("question_number")
        objectives = question.get("assessment_objectives")
        if not isinstance(objectives, list):
            continue

        for objective in objectives:
            if not isinstance(objective, dict):
                continue

            ao = objective.get("ao")
            # Point-based questions are extracted as the sentinel AO
            # "General". They have no level/band provenance to validate or
            # enrich, so retain the model's extracted data unchanged.
            if is_general_assessment_objective(ao):
                continue

            bands = objective.get("bands")
            if not isinstance(bands, list):
                continue

            for band_data in bands:
                if not isinstance(band_data, dict):
                    continue

                descriptor = band_data.get("descriptor")
                model_descriptors = band_data.get("descriptors")
                parsed_descriptors = split_descriptor_bullets(descriptor)
                valid_model_list = (
                    isinstance(model_descriptors, list)
                    and all(isinstance(item, str) for item in model_descriptors)
                )
                model_list = model_descriptors if valid_model_list else []

                normalised_application_descriptors = [
                    _normalise_for_comparison(item)
                    for item in parsed_descriptors
                ]
                normalised_model_descriptors = [
                    _normalise_for_comparison(item)
                    for item in model_list
                ]
                # A genuinely bulleted/numbered band has one unambiguous
                # source-defined split, so the model must match it exactly.
                # Flowing prose has no single correct split — our own
                # sentence-boundary guess and the model's are both judgment
                # calls, and demanding they agree exactly rejects perfectly
                # good extractions whenever the two guesses land differently
                # (observed to vary between otherwise-identical calls on the
                # same file). For prose, defer entirely to the content-
                # integrity check instead, which verifies the same words
                # survived without caring where the boundaries fall.
                shape_matches = (
                    bool(parsed_descriptors)
                    and valid_model_list
                    and (
                        not _has_bullet_markers(descriptor)
                        or (
                            len(parsed_descriptors) == len(model_list)
                            and normalised_application_descriptors
                            == normalised_model_descriptors
                        )
                    )
                )

                log_descriptor_validation_comparison(
                    question_number=question_number,
                    ao=ao,
                    band=band_data.get("band"),
                    descriptor=descriptor,
                    model_descriptors=model_list,
                    application_descriptors=parsed_descriptors,
                    normalised_application_descriptors=(
                        normalised_application_descriptors
                    ),
                    normalised_model_descriptors=normalised_model_descriptors,
                    shape_matches=shape_matches,
                )

                if not shape_matches:
                    issues.append(_issue(
                        rule=DESCRIPTOR_LIST_MISMATCH,
                        question_number=question_number,
                        ao=ao,
                        band=band_data.get("band"),
                        descriptor=descriptor,
                        parsed_descriptors=parsed_descriptors,
                        model_descriptors=model_list,
                        reason=(
                            "The list derived from the complete descriptor did not "
                            "match the model-generated descriptors list."
                        ),
                    ))

    return issues
