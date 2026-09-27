"""Interpretable evidence scoring shared by the API and Convex workflow."""

from .schemas import ScoreRequest, ScoreResponse


def _level(score: float) -> str:
    if score >= 65:
        return "Strong"
    if score >= 35:
        return "Emerging"
    return "Low"


def score_evidence(payload: ScoreRequest) -> ScoreResponse:
    diversity = min(payload.distinct_reporters * 12, 36)
    semantic = round(payload.semantic_agreement * 30)
    confirmations = min(payload.confirmations * 5, 20)
    unique_images = min(payload.unique_images * 4, 12)
    duplicate_penalty = min(payload.duplicate_images * 12, 36)
    metadata_penalty = min(payload.metadata_conflicts * 8, 24)
    contradiction_penalty = min(payload.contradictions * 7, 28)
    time = round((payload.time_proximity if payload.time_proximity is not None else 0.5) * 10)
    location = round(payload.location_consistency * 8) if payload.location_consistency is not None else 0
    visual = {"yes": 8, "partial": 4, "no": -4, "unavailable": 0}[payload.visual_match]

    score = max(0, min(100, diversity + semantic + confirmations + unique_images + time + location + visual
                        - duplicate_penalty - metadata_penalty - contradiction_penalty))
    reasons = [
        f"{payload.distinct_reporters} distinct reporter token{'s' if payload.distinct_reporters != 1 else ''} (+{diversity})",
        f"Semantic agreement {payload.semantic_agreement:.0%} (+{semantic})",
        f"Recent-report timing (+{time})",
    ]
    if payload.confirmations:
        reasons.append(f"{payload.confirmations} community confirmation{'s' if payload.confirmations != 1 else ''} (+{confirmations})")
    if payload.unique_images:
        reasons.append(f"{payload.unique_images} unique image{'s' if payload.unique_images != 1 else ''} (+{unique_images})")
    if payload.location_consistency is not None:
        reasons.append(f"Location consistency {payload.location_consistency:.0%} (+{location})")
    if visual:
        reasons.append(f"Visual match {payload.visual_match} ({visual:+d})")
    if duplicate_penalty:
        reasons.append(f"{payload.duplicate_images} reused image{'s' if payload.duplicate_images != 1 else ''} (-{duplicate_penalty})")
    if metadata_penalty:
        reasons.append(f"{payload.metadata_conflicts} metadata conflict{'s' if payload.metadata_conflicts != 1 else ''} (-{metadata_penalty})")
    if contradiction_penalty:
        reasons.append(f"{payload.contradictions} community contradiction{'s' if payload.contradictions != 1 else ''} (-{contradiction_penalty})")
    return ScoreResponse(support_score=float(score), evidence_level=_level(score), reasons=reasons)
