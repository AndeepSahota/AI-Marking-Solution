from pydantic import BaseModel, ConfigDict, Field


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SpecialistEvidence(StrictBaseModel):
    quote: str = Field(min_length=1)
    explanation: str = Field(min_length=1)


class ThreadSpecialistResult(StrictBaseModel):
    delimiter_token: str
    # The single best-fitting descriptor ID for THIS thread only, e.g.
    # "ao4-3a" -- copied exactly from the levels supplied for this thread,
    # never from another thread. If evidence is empty, this must be the
    # thread's lowest/zero-mark level -- never a higher one with nothing to
    # support it.
    descriptor_id: str = Field(min_length=1)
    reasoning: str = Field(min_length=1)
    # Deliberately NOT min_length=1 -- a thread can genuinely have no
    # evidence at all, and the model must be able to say so honestly rather
    # than invent something to fill the list.
    evidence: list[SpecialistEvidence]


class SpecialistStep(StrictBaseModel):
    # None only on the entry step ("does the response show the lowest level
    # at all?"), which has no level below it.
    from_descriptor_id: str | None
    to_descriptor_id: str = Field(min_length=1)
    difference: str = Field(min_length=1)
    # None when nothing in the response demonstrates the difference -- the
    # step is then not earned.
    quote: str | None
    explanation: str = Field(min_length=1)


class ThreadStepResult(StrictBaseModel):
    """Generic specialist output: one tested step per level boundary. The
    model never picks a level here -- specialists/steps.py derives it from
    the steps in code, so the reasoning and the awarded level cannot drift
    apart the way they did in single-call final marking.
    """
    delimiter_token: str
    steps: list[SpecialistStep]
