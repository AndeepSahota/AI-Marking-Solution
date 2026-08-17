from typing import Literal
from pydantic import BaseModel, ConfigDict


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )


# Nested inside each RubricCriterion rather than a separate top-level list —
# ties every quote to a specific AO structurally, instead of relying on a
# loosely-enforced matching field the model has to remember to fill in
# consistently (tried that first; it wasn't reliable).
class Evidence(StrictBaseModel):
    quote: str
    comment: str
    type: Literal["strength", "improvement"]
    marks_impact: int
    how_to_improve: str | None


class RubricCriterion(StrictBaseModel):
    criterion: str
    score_awarded: int
    max_marks: int
    reason: str
    evidence: list[Evidence]


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