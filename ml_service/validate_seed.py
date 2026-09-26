"""Validate fixture integrity, not model accuracy: python -m ml_service.validate_seed."""

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from .config import CLUSTER_WINDOW_SECONDS

SEED_PATH = Path(__file__).parent / "data" / "reports.json"


def validate_seed(path: Path = SEED_PATH) -> dict:
    dataset = json.loads(path.read_text(encoding="utf-8"))
    if dataset.get("synthetic") is not True:
        raise ValueError("Fixtures must be marked synthetic")
    reports = dataset["reports"]
    if len(reports) != 30:
        raise ValueError("Expected exactly 30 reports")
    for field in ("id", "reporter_token"):
        if len({report[field] for report in reports}) != 30:
            raise ValueError(f"Expected unique {field} values")
    by_id = {report["id"]: report for report in reports}
    counts = Counter(report["expected_cluster_id"] for report in reports)
    if set(counts) != set(dataset["clusters"]):
        raise ValueError("Cluster descriptions and report labels must agree")
    if dataset["cluster_window_seconds"] != CLUSTER_WINDOW_SECONDS:
        raise ValueError("Dataset and service clustering windows differ")
    for report in reports:
        for field in ("id", "reporter_token", "description", "category", "location", "expected_cluster_id"):
            if not isinstance(report[field], str) or not report[field].strip():
                raise ValueError(f"Missing or empty {field}")
        timestamp = datetime.fromisoformat(report["reported_at"])
        if timestamp.utcoffset() is None:
            raise ValueError("Report timestamps must include a timezone")
    for cluster in counts:
        members = [report for report in reports if report["expected_cluster_id"] == cluster]
        if len({report["location"] for report in members}) != 1:
            raise ValueError(f"Cluster {cluster} spans multiple canonical locations")
        times = [datetime.fromisoformat(report["reported_at"]) for report in members]
        if (max(times) - min(times)).total_seconds() > CLUSTER_WINDOW_SECONDS:
            raise ValueError(f"Cluster {cluster} exceeds the time window")
    for pair in dataset["pair_checks"]:
        left, right = by_id[pair["left"]], by_id[pair["right"]]
        if not isinstance(pair["same_cluster"], bool):
            raise ValueError("Pair expectations must be booleans")
        same = left["expected_cluster_id"] == right["expected_cluster_id"]
        if same != pair["same_cluster"]:
            raise ValueError(f"Pair check contradicts cluster labels: {pair}")
    return {"reports": len(reports), "clusters": len(counts), "pair_checks": len(dataset["pair_checks"])}


if __name__ == "__main__":
    print(json.dumps(validate_seed(), indent=2))
