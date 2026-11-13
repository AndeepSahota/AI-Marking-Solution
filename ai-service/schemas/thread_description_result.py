from typing import Literal

from pydantic import BaseModel, ConfigDict


NotFound = Literal["value not found"]


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )


class BandMark(StrictBaseModel):
    band: str
    marks: str


class ThreadLevel(StrictBaseModel):
    descriptor_id: str
    band: str
    text: str


class DescriptorThread(StrictBaseModel):
    thread_key: str
    thread_id: str
    thread_description: str
    # The evaluative words THIS thread's own levels use to tell one band from
    # the next (e.g. "valid", "appropriate", "developed" for a references
    # thread) -- extracted once per scheme upload so a specialist prompt can
    # name them as "attach as a label, never as the explanation" without us
    # hand-reading every new mark scheme's wording ourselves. See
    # specialists/steps.py for where this gets used.
    descriptor_vocabulary: list[str]
    levels: list[ThreadLevel]


class AssessmentObjectiveThreads(StrictBaseModel):
    ao: str
    marks_available: int | NotFound
    band_marks: list[BandMark]
    threads: list[DescriptorThread]


class QuestionThreads(StrictBaseModel):
    question: str
    marks_available: int | NotFound
    assessment_objectives: list[AssessmentObjectiveThreads]


class ThreadDescriptionResult(StrictBaseModel):
    delimiter_token: str
    questions: list[QuestionThreads]
