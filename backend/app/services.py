"""Shared serializers keep list, detail, mutations and analytics consistent."""
from datetime import datetime, timezone
from pathlib import Path
from sqlmodel import Session, select
from .models import Evidence, Incident, Report
from .evidence import inspect_bytes, phash_distance, iso, time_consistency, location_consistency
from .scoring import evidence_score


def now():
    return datetime.now(timezone.utc)


def upload_path(directory: Path, filename: str):
    # Never follow a stored path outside the upload root, including symlinks.
    root = directory.resolve()
    path = (root / filename).resolve()
    if Path(filename).name != filename or path.parent != root:
        raise ValueError("Invalid stored filename")
    return path


def duplicate_analysis(item, collection):
    matches = []
    for other in collection:
        if other.id == item.id:
            continue
        distance = phash_distance(item.perceptual_hash, other.perceptual_hash)
        exact = item.sha256_hash == other.sha256_hash
        if exact or (distance is not None and distance <= 6):
            matches.append((other, 0 if exact else distance, exact))
    prior = [(other, distance, exact) for other, distance, exact in matches if other.id < item.id]
    earliest = min([item] + [other for other, _, _ in matches], key=lambda e: e.id)
    return {
        "status": "Exact duplicate detected" if any(exact for _, _, exact in matches) else "Near-duplicate detected" if matches else "No duplicate evidence found",
        "duplicate_count": len(matches),
        "closest_duplicate_distance": min((distance for _, distance, _ in matches), default=None),
        "duplicate_of": min((other.id for other, _, _ in prior), default=None),
        "first_seen_at": iso(earliest.uploaded_at),
        "matched_evidence_ids": [other.id for other, _, _ in matches],
    }


def make_evidence(report, filename, original_filename, info, size, legacy=False):
    timestamp = now()
    timeline = [{"title": "Evidence uploaded", "timestamp": iso(report.created_at)}]
    if legacy:
        timeline.append({"title": "Existing report attachment indexed", "timestamp": iso(timestamp)})
    timeline.extend([
        {"title": "Metadata inspected" if info["type"] == "image" else "Video container identified", "timestamp": iso(timestamp)},
        {"title": "File hash generated", "timestamp": iso(timestamp)},
        {"title": "Duplicate scan completed", "timestamp": iso(timestamp)},
        {"title": "Evidence linked to incident", "timestamp": iso(timestamp)},
    ])
    return Evidence(report_id=report.id, incident_id=report.incident_id,
                    type=info["type"], original_filename=original_filename, stored_filename=filename,
                    mime_type=info["mime_type"], file_size=size, uploaded_at=report.created_at,
                    sha256_hash=info["sha256_hash"], perceptual_hash=info["phash"],
                    metadata_json=info["metadata"], source="unknown" if legacy else "gallery_upload", timeline=timeline)


def evidence_payload(item, report, incident, collection, duplicates=None):
    metadata = item.metadata_json
    duplicates = duplicates or {e.id: duplicate_analysis(e, collection) for e in collection}
    duplicate = duplicates[item.id]
    time = time_consistency(report.created_at, metadata.get("capture_timestamp"))
    location = location_consistency(report, metadata)
    conflict = "conflicting" in (time["status"], location["status"])
    status = "metadata_conflict" if conflict else "duplicate" if duplicate["duplicate_of"] else "needs_review" if "needs_review" in (time["status"], location["status"]) else "consistent" if "consistent" in (time["status"], location["status"]) else "needs_review"
    # Allocate the existing incident's +4/image (cap +12) and -12/reuse
    # (cap -36) terms in stable evidence-ID order, never invent a /25 score.
    related = sorted([e for e in collection if e.incident_id == item.incident_id], key=lambda e: e.id)
    reused = [e.id for e in related if duplicates[e.id]["duplicate_of"]]
    unique = [e.id for e in related if e.perceptual_hash and e.id not in reused]
    contribution = -12 if item.id in reused[:3] else 4 if item.id in unique[:3] else 0
    return {
        "id": item.id, "report_id": item.report_id, "incident_id": item.incident_id,
        "title": incident.title, "reported_claim": report.description,
        "location": report.location, "type": item.type, "url": f"/uploads/{item.stored_filename}",
        "original_filename": item.original_filename, "mime_type": item.mime_type,
        "file_size": item.file_size, "uploaded_at": iso(item.uploaded_at),
        "sha256_hash": item.sha256_hash, "perceptual_hash": item.perceptual_hash,
        "metadata": metadata,
        "provenance": {"source": item.source, "in_app_capture": False if item.source == "gallery_upload" else None,
                       "server_received_at": iso(item.uploaded_at), "reporter_id": f"report-{report.id}"},
        "duplicate_analysis": duplicate, "time_consistency": time, "location_consistency": location,
        "content_consistency": {
            "reported_claim": report.description,
            "visual_summary": report.visual_match_reason,
            "score": report.visual_match_confidence,
            "status": report.visual_match or "unavailable",
            "reason": report.visual_match_reason,
        },
        "status": status, "support_contribution": contribution,
        "review_state": item.review_state, "timeline": item.timeline,
    }


def all_evidence(session):
    collection = session.exec(select(Evidence).order_by(Evidence.id)).all()
    reports = {r.id: r for r in session.exec(select(Report)).all()}
    incidents = {i.id: i for i in session.exec(select(Incident)).all()}
    duplicates = {e.id: duplicate_analysis(e, collection) for e in collection}
    return [evidence_payload(e, reports[e.report_id], incidents[e.incident_id], collection, duplicates)
            for e in collection if e.report_id in reports and e.incident_id in incidents]


def summary(items):
    return {"total_evidence": len(items),
            "unique_images": sum(e["type"] == "image" and not e["duplicate_analysis"]["duplicate_of"] for e in items),
            "duplicate_reused": sum(bool(e["duplicate_analysis"]["duplicate_of"]) for e in items),
            "metadata_conflicts": sum(e["status"] == "metadata_conflict" for e in items)}


def incident_payload(session, incident, detail=False, evidence=None, persist=False, reports=None):
    if reports is None:
        reports = session.exec(select(Report).where(Report.incident_id == incident.id).order_by(Report.id)).all()
    evidence = all_evidence(session) if evidence is None else evidence
    attached = [e for e in evidence if e["incident_id"] == incident.id]
    sims = [r.semantic_similarity for r in reports if r.semantic_similarity > 0]
    # No fabricated agreement when no comparison was made.
    average = sum(sims) / len(sims) if sims else 0
    duplicates = sum(bool(e["duplicate_analysis"]["duplicate_of"]) for e in attached)
    unique = sum(bool(e["perceptual_hash"]) and not e["duplicate_analysis"]["duplicate_of"] for e in attached)
    score, level, reasons = evidence_score(len({r.reporter_token for r in reports}), average,
        incident.confirmations, incident.contradictions, unique, duplicates,
        sum(r.location.strip().casefold() == incident.location.strip().casefold() for r in reports) / len(reports) if reports else 0,
        next(
            (
                r.visual_match
                for r in reversed(reports)
                if r.visual_match in {"yes", "partial", "no", "unavailable"}
            ),
            "unavailable",
        ),
    )
    if persist:
        incident.support_score, incident.evidence_level, incident.updated_at = score, level, now()
        session.add(incident)
    result = {**incident.model_dump(), "created_at": iso(incident.created_at),
              "updated_at": iso(incident.updated_at or incident.created_at),
              "description": reports[0].description if reports else incident.title,
              "support_score": score, "evidence_level": level, "reasons": reasons,
              "report_count": len(reports),
              "evidence": [{k: e[k] for k in ("id", "report_id", "type", "url", "uploaded_at")} for e in attached]}
    if detail:
        # reporter_token is a pseudonym used for grouping, not a public identity.
        result["reports"] = [{**r.model_dump(exclude={"reporter_token", "exif_gps"}), "created_at": iso(r.created_at)} for r in reports]
    return result
