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


class ReferenceSpecialistStep(StrictBaseModel):
    """Same as SpecialistStep, but "explanation" is split into three boxes
    plus a dedicated slot for descriptor wording -- thread C kept earning
    steps by using the level descriptor's own words ("appropriate and
    relevant") as if restating the label were the same as justifying it.
    Giving descriptor wording its own field (`descriptor_phrase_matched`)
    means the model never has to avoid those words; it only has to keep
    them out of the other two fields, which ask for plain description and
    reasoning instead. specialists/steps.py checks that split in code.
    """
    from_descriptor_id: str | None
    to_descriptor_id: str = Field(min_length=1)
    difference: str = Field(min_length=1)
    quote: str | None
    # Plain description of what the quote shows, in the model's own words
    # -- no descriptor vocabulary. None only when quote is also None.
    what_student_does: str | None
    # The actual reasoning connecting what_student_does to this level's
    # requirement -- still no descriptor vocabulary here.
    why_this_meets_criterion: str | None
    # The ONLY field allowed to contain the level descriptor's own wording.
    descriptor_phrase_matched: str | None


class ReferenceStepResult(StrictBaseModel):
    delimiter_token: str
    steps: list[ReferenceSpecialistStep]
