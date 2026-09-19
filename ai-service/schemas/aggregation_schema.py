from pydantic import BaseModel, ConfigDict, Field


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )


class AggregatedEvidence(StrictBaseModel):
    quote: str
    descriptor_ids: list[str] = Field(min_length=1)


class AggregationResult(StrictBaseModel):
    delimiter_token: str
    evidence: list[AggregatedEvidence]
