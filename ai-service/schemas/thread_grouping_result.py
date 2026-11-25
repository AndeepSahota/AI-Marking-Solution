from schemas.ms_schema import StrictBaseModel


class ThreadGroup(StrictBaseModel):
    threads: list[str]


class ThreadGroupingResult(StrictBaseModel):
    """Which threads of one objective are judged together
    (transformations/thread_grouping_prompt.py)."""
    delimiter_token: str
    groups: list[ThreadGroup]
