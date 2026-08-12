from typing import Literal
from pydantic import BaseModel, ConfigDict


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )


class RubricCriterion(StrictBaseModel):
    criterion: str
    score_awarded: int
    max_marks: int
    reason: str


class Annotation(StrictBaseModel):
    quote: str
    comment: str
    type: Literal["strength", "improvement"]


class MarkingResult(StrictBaseModel):
    max_score_detected: int
    delimiter_token: str
    strengths: list[str]
    improvements: list[str]
    actionable_steps: list[str]
    rubric_breakdown: list[RubricCriterion]
    teacher_review_required: bool
    question_mismatch: bool
    question_mismatch_reason: str | None
    annotations: list[Annotation]
