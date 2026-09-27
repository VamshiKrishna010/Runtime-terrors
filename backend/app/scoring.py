def evidence_score(
    distinct_reporters: int,
    avg_semantic_similarity: float,
    confirmations: int,
    contradictions: int,
    unique_images: int,
    duplicate_images: int,
    location_consistency: float = 0.0,
    visual_match: str = "unavailable",
) -> tuple[float, str, list[str]]:
    # Interpretable hackathon score. This is NOT a probability of truth.
    score = 0.0
    reasons: list[str] = []

    reporter_points = min(distinct_reporters * 12, 36)
    score += reporter_points
    reasons.append(f"{distinct_reporters} distinct pseudonymous reporter(s): +{reporter_points:.0f}")

    semantic_points = max(0.0, min(avg_semantic_similarity, 1.0)) * 22
    score += semantic_points
    reasons.append(f"description word overlap {avg_semantic_similarity:.2f}: +{semantic_points:.0f}")

    confirm_points = min(confirmations * 5, 20)
    score += confirm_points
    reasons.append(f"{confirmations} confirmation(s): +{confirm_points:.0f}")

    location_points = max(0.0, min(location_consistency, 1.0)) * 10
    score += location_points
    if location_points:
        reasons.append(f"reported location agreement: +{location_points:.0f}")

    image_points = min(unique_images * 4, 12)
    score += image_points
    if unique_images:
        reasons.append(f"{unique_images} unique evidence image(s): +{image_points:.0f}")

    duplicate_penalty = min(duplicate_images * 12, 36)
    score -= duplicate_penalty
    if duplicate_penalty:
        reasons.append(f"duplicate/reused evidence: -{duplicate_penalty:.0f}")

    contradiction_penalty = min(contradictions * 7, 28)
    score -= contradiction_penalty
    if contradiction_penalty:
        reasons.append(f"{contradictions} contradiction(s): -{contradiction_penalty:.0f}")

    visual_points = {
        "yes": 6,
        "partial": 3,
        "no": -6,
        "unavailable": 0,
    }.get(visual_match, 0)

    score += visual_points

    if visual_match != "unavailable":
        sign = "+" if visual_points >= 0 else ""
        reasons.append(
            f"image/report visual comparison ({visual_match}): "
            f"{sign}{visual_points}"
        )

    score = round(max(0.0, min(score, 100.0)), 1)
    level = "Low" if score < 35 else "Emerging" if score < 70 else "Strong"
    return score, level, reasons
