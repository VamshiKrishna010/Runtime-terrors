import logging
import math
import os
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field as PydanticField
from sqlalchemy import delete, event
from sqlmodel import Session, create_engine, select

from .database import initialize
from .analytics import aggregate_analytics
from .evidence import MAX_UPLOAD_BYTES, inspect_bytes, iso, utc
from .ml import best_similarity
from .groq_vision import analyze_image_with_groq, compare_image_to_claim
from .qwen_authenticity import analyze_image_authenticity
from .models import Evidence, Incident, Report, Vote
from .services import all_evidence, duplicate_analysis, incident_payload, make_evidence, now, summary, upload_path

BASE = Path(__file__).resolve().parent.parent
CATEGORIES = {"Network / IT", "Facilities", "Environmental", "Safety", "Other"}
log = logging.getLogger(__name__)


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review_state: Literal["unreviewed", "reviewed", "flagged"]


class VoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reporter_token: str = PydanticField(min_length=1, max_length=200)


def create_app(database_url=None, uploads_dir=None, allow_cleanup=None):
    database_url = database_url or os.getenv("VERIPULSE_DATABASE_URL", f"sqlite:///{BASE / 'veripulse.db'}")
    uploads = Path(uploads_dir or os.getenv("VERIPULSE_UPLOADS_DIR", str(BASE / "uploads"))).resolve()
    uploads.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def sqlite_settings(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    @asynccontextmanager
    async def lifespan(app):
        initialize(engine, uploads)
        yield
        engine.dispose()

    app = FastAPI(title="VeriPulse API", lifespan=lifespan)
    app.state.engine, app.state.uploads = engine, uploads
    cleanup_enabled = (allow_cleanup if allow_cleanup is not None else os.getenv("VERIPULSE_ENABLE_DEV_CLEANUP") == "1") and os.getenv("VERIPULSE_ENV", "development").lower() != "production"
    origins = [origin.strip() for origin in os.getenv("VERIPULSE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type"])
    app.mount("/uploads", StaticFiles(directory=uploads), name="uploads")

    def get_incident(session, incident_id):
        incident = session.get(Incident, incident_id)
        if incident is None:
            raise HTTPException(404, "Incident not found")
        return incident

    def get_evidence(session, evidence_id):
        item = session.get(Evidence, evidence_id)
        if item is None:
            raise HTTPException(404, "Evidence not found")
        return item

    @app.get("/health")
    def health():
        return {"ok": True, "capabilities": {"metadata": True, "hashing": True, "visual_analysis": True}}

    @app.get("/incidents")
    def list_incidents():
        with Session(engine) as session:
            evidence = all_evidence(session)
            return [incident_payload(session, item, evidence=evidence) for item in session.exec(select(Incident).order_by(Incident.created_at.desc())).all()]

    @app.get("/incidents/{incident_id}")
    def incident_detail(incident_id: int):
        with Session(engine) as session:
            return incident_payload(session, get_incident(session, incident_id), detail=True)

    @app.post("/evidence/analyze")
    async def analyze_evidence(image: UploadFile = File(...), description: str = Form("")):
        try:
            data = await image.read(MAX_UPLOAD_BYTES + 1)

            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Evidence exceeds the 10 MB limit")

            info = inspect_bytes(data, image.content_type or "")

            if info["type"] != "image":
                raise HTTPException(422, "Visual analysis currently requires an image")

            temp_path = uploads / f"analysis-{uuid4().hex}{info['suffix']}"
            temp_path.write_bytes(data)

            try:
                vision_analysis = analyze_image_with_groq(str(temp_path))
                authenticity = analyze_image_authenticity(str(temp_path))
                visual_comparison = compare_image_to_claim(
                    str(temp_path),
                    description,
                )
            finally:
                temp_path.unlink(missing_ok=True)

            metadata = info["metadata"]

            gps = None
            if metadata.get("gps_latitude") is not None and metadata.get("gps_longitude") is not None:
                gps = f"{metadata['gps_latitude']},{metadata['gps_longitude']}"

            return {
                "imagePhash": info["phash"],
                "exifDatetime": metadata.get("capture_timestamp"),
                "exifGps": gps,
                "visionAnalysis": vision_analysis,
                "authenticity": authenticity,
                "visualComparison": visual_comparison,
            }

        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        finally:
            await image.close()

    @app.post("/reports", status_code=201)
    async def create_report(
        reporter_token: str = Form(...), description: str = Form(...),
        category: str = Form(...), location: str = Form(...),
        latitude: Optional[float] = Form(None), longitude: Optional[float] = Form(None),
        image: Optional[UploadFile] = File(None),
    ):
        reporter_token, description, category, location = [value.strip() for value in (reporter_token, description, category, location)]
        if not reporter_token or len(reporter_token) > 200 or not description or len(description) > 4000 or not location or len(location) > 300:
            raise HTTPException(422, "Reporter token, description and location must be nonblank and within 200, 4000 and 300 characters")
        if category not in CATEGORIES:
            raise HTTPException(422, "Unsupported category")
        if (latitude is None) != (longitude is None):
            raise HTTPException(422, "Provide both latitude and longitude")
        if latitude is not None and (not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180):
            raise HTTPException(422, "Invalid coordinates")
        data = info = filename = original = None
        if image and image.filename:
            try:
                data = await image.read(MAX_UPLOAD_BYTES + 1)
                if len(data) > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Evidence exceeds the 10 MB limit")
                info = inspect_bytes(data, image.content_type or "")
                filename = uuid4().hex + info["suffix"]
                original = image.filename.replace("\\", "/").split("/")[-1][:255]
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            finally:
                await image.close()
        saved = None
        try:
            with Session(engine) as session:
                # Serialize writers: association, votes and counters are transactional.
                session.connection().exec_driver_sql("BEGIN IMMEDIATE")
                candidate, best = None, 0.0
                timestamp = now()
                for incident in session.exec(select(Incident).order_by(Incident.id)).all():
                    if incident.location.strip().casefold() != location.casefold() or incident.category != category:
                        continue
                    # Prevent unrelated later outages joining a historical cluster.
                    reports = session.exec(select(Report).where(Report.incident_id == incident.id)).all()
                    latest_report = max((utc(report.created_at) for report in reports), default=utc(incident.created_at))
                    if (timestamp - latest_report).total_seconds() > 7200:
                        continue
                    overlap = best_similarity(description, [report.description for report in reports])
                    if overlap > best:
                        candidate, best = incident, overlap
                if candidate is None or best < 0.20:
                    candidate = Incident(title=description[:70], category=category, location=location,
                                         latitude=latitude, longitude=longitude, created_at=timestamp, updated_at=timestamp)
                    session.add(candidate)
                    session.flush()
                    best = 0.0
                elif candidate.latitude is None and latitude is not None:
                    candidate.latitude, candidate.longitude = latitude, longitude
                report = Report(incident_id=candidate.id, reporter_token=reporter_token, description=description,
                                category=category, location=location, latitude=latitude, longitude=longitude,
                                created_at=timestamp, semantic_similarity=best,
                                image_path=f"/uploads/{filename}" if filename else None,
                                image_phash=info["phash"] if info else None,
                                exif_datetime=info["metadata"].get("capture_timestamp") if info else None)
                session.add(report)
                session.flush()
                if info:
                    saved = upload_path(uploads, filename)
                    saved.write_bytes(data)

                    # Compare the visible image evidence with the written report.
                    # compare_image_to_claim handles model/API failures by returning
                    # an "unavailable" result instead of blocking submission.
                    visual_comparison = compare_image_to_claim(
                        str(saved),
                        description,
                    )
                    report.visual_match = visual_comparison["match"]
                    report.visual_match_confidence = visual_comparison["confidence"]
                    report.visual_match_reason = visual_comparison["reason"]

                    item = make_evidence(report, filename, original, info, len(data))
                    session.add(item)
                    session.flush()
                    report.duplicate_evidence = bool(
                        duplicate_analysis(
                            item,
                            session.exec(select(Evidence)).all(),
                        )["duplicate_of"]
                    )
                    session.add(report)
                result = incident_payload(session, candidate, detail=True, persist=True)
                if info:
                    item.timeline = [*item.timeline, {"title": "Support score recalculated", "timestamp": iso(now())}]
                    session.add(item)
                session.commit()
                return {"report": {**report.model_dump(exclude={"reporter_token", "exif_gps"}), "created_at": iso(report.created_at)},
                        "incident": result, "reasons": result["reasons"]}
        except Exception:
            if saved:
                saved.unlink(missing_ok=True)
            raise

    def record_vote(incident_id, action, payload):
        with Session(engine) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            incident = get_incident(session, incident_id)
            previous = None
            if payload:
                token = payload.reporter_token.strip()
                if not token:
                    raise HTTPException(422, "Reporter token must be nonblank")
                previous = session.exec(select(Vote).where(Vote.incident_id == incident_id, Vote.reporter_token == token)).first()
                if previous and previous.action == action:
                    return incident_payload(session, incident, detail=True)
                if previous:
                    field = "confirmations" if previous.action == "confirm" else "contradictions"
                    setattr(incident, field, max(0, getattr(incident, field) - 1))
                    previous.action = action
                    session.add(previous)
                else:
                    session.add(Vote(incident_id=incident_id, reporter_token=token, action=action))
            field = "confirmations" if action == "confirm" else "contradictions"
            setattr(incident, field, getattr(incident, field) + 1)
            result = incident_payload(session, incident, detail=True, persist=True)
            session.commit()
            return result

    @app.post("/incidents/{incident_id}/confirm")
    def confirm(incident_id: int, payload: Optional[VoteInput] = None):
        return record_vote(incident_id, "confirm", payload)

    @app.post("/incidents/{incident_id}/contradict")
    def contradict(incident_id: int, payload: Optional[VoteInput] = None):
        return record_vote(incident_id, "contradict", payload)

    @app.get("/evidence/summary")
    def evidence_summary():
        with Session(engine) as session:
            return summary(all_evidence(session))

    @app.get("/evidence")
    def list_evidence(search: str = "", status: Optional[Literal["consistent", "needs_review", "metadata_conflict", "duplicate"]] = None, incident_id: Optional[int] = None,
                      type: Optional[Literal["image", "video", "screenshot"]] = None,
                      sort: Literal["newest", "highest_support", "needs_review", "duplicate_first"] = "newest"):
        with Session(engine) as session:
            items = all_evidence(session)
            items = [e for e in items if (not search or search.casefold() in f"{e['title']} {e['location']} {e['reported_claim']} {e['id']}".casefold())
                     and (not status or e["status"] == status) and (incident_id is None or e["incident_id"] == incident_id)
                     and (not type or e["type"] == type)]
            key = {"newest": lambda e: e["id"], "highest_support": lambda e: (e["support_contribution"], e["id"]),
                   "needs_review": lambda e: (e["status"] in ("needs_review", "metadata_conflict"), e["id"]),
                   "duplicate_first": lambda e: (bool(e["duplicate_analysis"]["duplicate_of"]), e["id"])}[sort]
            return sorted(items, key=key, reverse=True)

    @app.get("/evidence/{evidence_id}")
    def evidence_detail(evidence_id: int):
        with Session(engine) as session:
            get_evidence(session, evidence_id)
            return next(e for e in all_evidence(session) if e["id"] == evidence_id)

    @app.patch("/evidence/{evidence_id}/review")
    def review_evidence(evidence_id: int, payload: ReviewInput):
        with Session(engine) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            item = get_evidence(session, evidence_id)
            if item.review_state != payload.review_state:
                item.review_state = payload.review_state
                item.timeline = [*item.timeline, {"title": f"Human review updated: {payload.review_state}", "timestamp": iso(now())}]
                session.add(item)
                session.commit()
            return next(e for e in all_evidence(session) if e["id"] == evidence_id)

    @app.get("/analytics/summary")
    def analytics_summary(
        range: Literal["24h", "7d", "30d", "all"] = "all",
        category: Optional[Literal["Network / IT", "Facilities", "Environmental", "Safety", "Other"]] = None,
        evidence_level: Optional[Literal["Low", "Emerging", "Strong"]] = None,
        location: Optional[str] = None,
    ):
        with Session(engine) as session:
            return aggregate_analytics(session, range, category, evidence_level, location)

    def delete_incidents(incident_id=None):
        if not cleanup_enabled:
            raise HTTPException(404, "Development cleanup is disabled")
        with Session(engine) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            if incident_id is not None:
                get_incident(session, incident_id)
            ids = [incident_id] if incident_id is not None else list(session.exec(select(Incident.id)).all())
            reports = session.exec(select(Report).where(Report.incident_id.in_(ids))).all()
            evidence = session.exec(select(Evidence).where(Evidence.incident_id.in_(ids))).all()
            votes = session.exec(select(Vote).where(Vote.incident_id.in_(ids))).all()
            incidents = session.exec(select(Incident).where(Incident.id.in_(ids))).all()
            filenames = {e.stored_filename for e in evidence} | {r.image_path.removeprefix("/uploads/") for r in reports if r.image_path and r.image_path.startswith("/uploads/")}
            counts = {"incidents": len(incidents), "reports": len(reports), "evidence": len(evidence), "votes": len(votes),
                      "confirmations": sum(i.confirmations for i in incidents), "contradictions": sum(i.contradictions for i in incidents)}
            for model in (Evidence, Vote, Report):
                session.exec(delete(model).where(model.incident_id.in_(ids)))
            session.exec(delete(Incident).where(Incident.id.in_(ids)))
            session.flush()
            referenced = set(session.exec(select(Evidence.stored_filename)).all())
            referenced |= {path.removeprefix("/uploads/") for path in session.exec(select(Report.image_path)).all() if path and path.startswith("/uploads/")}
            session.commit()
            removed, failed = 0, 0
            for filename in filenames - referenced:
                try:
                    path = upload_path(uploads, filename)
                    if path.is_file():
                        path.unlink()
                        removed += 1
                except (ValueError, OSError):
                    failed += 1
                    log.warning("Could not remove an unreferenced evidence file")
            return {**counts, "files_removed": removed, "files_not_removed": failed}

    @app.delete("/dev/incidents")
    def cleanup():
        return delete_incidents()

    @app.delete("/incidents/{incident_id}")
    def delete_incident(incident_id: int):
        return delete_incidents(incident_id)

    return app


app = create_app()
