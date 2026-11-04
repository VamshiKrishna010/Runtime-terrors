"""JSON contracts for the ML service."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
UnitInterval = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Count = Annotated[int, Field(ge=0, strict=True)]
Embedding = Annotated[
    list[Annotated[float, Field(allow_inf_nan=False)]],
    Field(min_length=384, max_length=384),
]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmbedRequest(Contract):
    texts: list[Text] = Field(min_length=1, max_length=64)


class EmbedResponse(Contract):
    model: Literal["sentence-transformers/all-MiniLM-L6-v2"]
    dimensions: Literal[384] = 384
    normalized: Literal[True] = True
    embeddings: list[Embedding] = Field(min_length=1, max_length=64)


class ScoreRequest(Contract):
    distinct_reporters: Count
    semantic_agreement: UnitInterval
    confirmations: Count = 0
    contradictions: Count = 0
    unique_images: Count = 0
    duplicate_images: Count = 0
    metadata_conflicts: Count = 0
    # Corroborating reports within 30 minutes of the newest one: 0 for a lone
    # report, 0.5 for one other, 1 for two or more. Location consistency is
    # deliberately absent: clustering already requires the same location.
    time_proximity: UnitInterval | None = None
    visual_match: Literal["yes", "partial", "no", "unavailable"] = "unavailable"


class ScoreResponse(Contract):
    support_score: float = Field(ge=0, le=100)
    evidence_level: Literal["Low", "Emerging", "Strong"]
    reasons: list[str]
