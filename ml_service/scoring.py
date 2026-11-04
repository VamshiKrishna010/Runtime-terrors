"""Python mirror of the canonical scorer in frontend/convex/lib/scoring.ts.

The live app scores incidents inside Convex. This copy powers `POST /score`
for offline evaluation. Both are tested against shared/scoring_cases.json, so
a weight changed in one place without the other fails CI.
"""

import math

from .schemas import ScoreRequest, ScoreResponse

WEIGHTS = {
    "reporter": 12, "reporter_cap": 36,
    "semantic": 30,
    "confirmation": 5, "confirmation_cap": 20,
    "image": 4, "image_cap": 12,
    "duplicate": 12, "duplicate_cap": 36,
    "metadata": 8, "metadata_cap": 24,
    "contradiction": 7, "contradiction_cap": 28,
    "time": 10,
    "visual": {"yes": 8, "partial": 4, "no": -4, "unavailable": 0},
    "strong_at": 65,
    "emerging_at": 35,
}


def _round_half_up(value: float) -> int:
    # Python's round() is banker's rounding; match JavaScript's half-up.
    return math.floor(value + 0.5)


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _level(score: float) -> str:
    if score >= WEIGHTS["strong_at"]:
        return "Strong"
    if score >= WEIGHTS["emerging_at"]:
        return "Emerging"
    return "Low"


def score_evidence(payload: ScoreRequest) -> ScoreResponse:
    w = WEIGHTS
    time_proximity = payload.time_proximity if payload.time_proximity is not None else 0.0

    diversity = min(payload.distinct_reporters * w["reporter"], w["reporter_cap"])
    semantic = _round_half_up(payload.semantic_agreement * w["semantic"])
    confirmations = min(payload.confirmations * w["confirmation"], w["confirmation_cap"])
    unique_images = min(payload.unique_images * w["image"], w["image_cap"])
    duplicate_penalty = min(payload.duplicate_images * w["duplicate"], w["duplicate_cap"])
    metadata_penalty = min(payload.metadata_conflicts * w["metadata"], w["metadata_cap"])
    contradiction_penalty = min(payload.contradictions * w["contradiction"], w["contradiction_cap"])
    time = _round_half_up(time_proximity * w["time"])
    visual = w["visual"][payload.visual_match]

    score = max(0, min(100, diversity + semantic + confirmations + unique_images + time + visual
                        - duplicate_penalty - metadata_penalty - contradiction_penalty))
    reasons = [
        f"{_plural(payload.distinct_reporters, 'distinct reporter token')} (+{diversity})",
        f"Semantic agreement {_round_half_up(payload.semantic_agreement * 100)}% (+{semantic})",
    ]
    if time:
        reasons.append(f"Corroborating reports within 30 minutes (+{time})")
    if payload.confirmations:
        reasons.append(f"{_plural(payload.confirmations, 'community confirmation')} (+{confirmations})")
    if payload.unique_images:
        reasons.append(f"{_plural(payload.unique_images, 'unique image')} (+{unique_images})")
    if visual:
        reasons.append(f"Visual match {payload.visual_match} ({visual:+d})")
    if duplicate_penalty:
        reasons.append(f"{_plural(payload.duplicate_images, 'reused image')} (-{duplicate_penalty})")
    if metadata_penalty:
        reasons.append(f"{_plural(payload.metadata_conflicts, 'metadata conflict')} (-{metadata_penalty})")
    if contradiction_penalty:
        reasons.append(f"{_plural(payload.contradictions, 'community contradiction')} (-{contradiction_penalty})")
    return ScoreResponse(support_score=float(score), evidence_level=_level(score), reasons=reasons)
