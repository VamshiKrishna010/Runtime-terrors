"""Evaluate MiniLM on the labelled pair checks and recommend a threshold."""

import json
from pathlib import Path

from .config import CLUSTER_SIMILARITY_THRESHOLD
from .embedding import embed_texts


ROOT = Path(__file__).resolve().parent


def cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def evaluate() -> dict:
    fixture = json.loads((ROOT / "data" / "reports.json").read_text(encoding="utf-8"))
    reports = {report["id"]: report for report in fixture["reports"]}
    vectors = dict(zip(reports, embed_texts([report["description"] for report in reports.values()])))
    rows = [{
        **pair,
        "similarity": cosine(vectors[pair["left"]], vectors[pair["right"]]),
    } for pair in fixture["pair_checks"]]
    candidates = sorted({round(row["similarity"], 2) for row in rows})
    best = max(candidates, key=lambda threshold: sum(
        (row["similarity"] >= threshold) == row["same_cluster"] for row in rows
    ))
    return {"configured_threshold": CLUSTER_SIMILARITY_THRESHOLD, "recommended_threshold": best, "pairs": rows}


if __name__ == "__main__":
    result = evaluate()
    print(f"Configured: {result['configured_threshold']:.2f}; recommended: {result['recommended_threshold']:.2f}")
    for pair in result["pairs"]:
        print(f"{pair['left']} <-> {pair['right']}: {pair['similarity']:.3f} ({'same' if pair['same_cluster'] else 'different'})")
