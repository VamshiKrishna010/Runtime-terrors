from pathlib import Path
from uuid import uuid4
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import SQLModel, Session, create_engine, select

from .models import Incident, Report
from .ml import best_similarity
from .evidence import analyze_image, phash_distance
from .scoring import evidence_score
from .convex_client import convex_mutation, upload_image

BASE = Path(__file__).resolve().parent.parent
UPLOADS = BASE / "uploads"
UPLOADS.mkdir(exist_ok=True)
engine = create_engine(f"sqlite:///{BASE / 'veripulse.db'}", connect_args={"check_same_thread": False})

app = FastAPI(title="VeriPulse API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=UPLOADS), name="uploads")

@app.on_event("startup")
def startup():
    SQLModel.metadata.create_all(engine)


def recalc_incident(session: Session, incident: Incident):
    reports = session.exec(select(Report).where(Report.incident_id == incident.id)).all()
    reporters = len(set(r.reporter_token for r in reports))
    sims = [r.semantic_similarity for r in reports if r.semantic_similarity > 0]
    avg_sim = sum(sims) / len(sims) if sims else (1.0 if len(reports) > 1 else 0.0)
    unique_hashes = set(r.image_phash for r in reports if r.image_phash and not r.duplicate_evidence)
    dup_count = sum(1 for r in reports if r.duplicate_evidence)

    # Basic location consistency: reports sharing the same typed location.
    same_loc = sum(1 for r in reports if r.location.strip().lower() == incident.location.strip().lower())
    loc_consistency = same_loc / len(reports) if reports else 0.0

    score, level, reasons = evidence_score(
        reporters, avg_sim, incident.confirmations, incident.contradictions,
        len(unique_hashes), dup_count, loc_consistency
    )
    incident.support_score = score
    incident.evidence_level = level
    session.add(incident)
    session.commit()
    session.refresh(incident)
    return reasons

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/incidents")
def list_incidents():
    with Session(engine) as session:
        items = session.exec(select(Incident).order_by(Incident.created_at.desc())).all()
        out = []
        for incident in items:
            reports = session.exec(select(Report).where(Report.incident_id == incident.id)).all()
            reasons = recalc_incident(session, incident)
            out.append({
                **incident.model_dump(),
                "report_count": len(reports),
                "reasons": reasons,
            })
        return out

@app.get("/incidents/{incident_id}")
def incident_detail(incident_id: int):
    with Session(engine) as session:
        incident = session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(404, "Incident not found")
        reports = session.exec(select(Report).where(Report.incident_id == incident_id)).all()
        reasons = recalc_incident(session, incident)
        return {
            **incident.model_dump(),
            "reports": [r.model_dump() for r in reports],
            "reasons": reasons,
        }

@app.post("/reports")
async def create_report(
    reporter_token: str = Form(...),
    description: str = Form(...),
    category: str = Form(...),
    location: str = Form(...),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    image: Optional[UploadFile] = File(None),
):
    with Session(engine) as session:
        incidents = session.exec(select(Incident)).all()
        candidate = None
        best = 0.0

        for inc in incidents:
            reports = session.exec(
                select(Report).where(Report.incident_id == inc.id)
            ).all()

            texts = [r.description for r in reports]
            sim = best_similarity(description, texts)
            same_place = location.strip().lower() == inc.location.strip().lower()

            if same_place and sim > best:
                best, candidate = sim, inc

        # Create a new incident if no suitable existing incident was found.
        if candidate is None or best < 0.20:
            candidate = Incident(
                title=description[:70],
                category=category,
                location=location,
                latitude=latitude,
                longitude=longitude,
            )
            session.add(candidate)
            session.commit()
            session.refresh(candidate)
            best = 0.0

        # Analyze and store optional image evidence.
        image_path = None
        image_storage_id = None
        phash = exif_dt = exif_gps = None
        duplicate = False

        if image and image.filename:
            suffix = Path(image.filename).suffix.lower() or ".jpg"
            filename = f"{uuid4().hex}{suffix}"
            dest = UPLOADS / filename

            image_bytes = await image.read()
            dest.write_bytes(image_bytes)

            image_path = f"/uploads/{filename}"

            # Upload the same image to Convex Storage.
            image_storage_id = await upload_image(
                image_bytes,
                image.content_type or "application/octet-stream",
            )

            # Analyze EXIF metadata and perceptual hash locally.
            info = analyze_image(str(dest))
            phash = info["phash"]
            exif_dt = info["exif_datetime"]
            exif_gps = info["exif_gps"]

            # Check whether similar image evidence already exists.
            if phash:
                existing = session.exec(
                    select(Report).where(Report.image_phash.is_not(None))
                ).all()

                for r in existing:
                    dist = phash_distance(phash, r.image_phash)
                    if dist is not None and dist <= 6:
                        duplicate = True
                        break

        # Save the report to SQLite.
        report = Report(
            incident_id=candidate.id,
            reporter_token=reporter_token,
            description=description,
            category=category,
            location=location,
            latitude=latitude,
            longitude=longitude,
            image_path=image_path,
            image_phash=phash,
            exif_datetime=exif_dt,
            exif_gps=exif_gps,
            duplicate_evidence=duplicate,
            semantic_similarity=best,
        )

        session.add(report)
        session.commit()
        session.refresh(report)

        reasons = recalc_incident(session, candidate)
        session.refresh(report)

        # Build the Convex incident data.
        convex_incident = {
            "sqliteIncidentId": candidate.id,
            "title": candidate.title,
            "category": candidate.category,
            "location": candidate.location,
            "supportScore": candidate.support_score,
            "evidenceLevel": candidate.evidence_level,
            "confirmations": candidate.confirmations,
            "contradictions": candidate.contradictions,
        }

        # Omit optional coordinates when they are None.
        if candidate.latitude is not None:
            convex_incident["latitude"] = candidate.latitude

        if candidate.longitude is not None:
            convex_incident["longitude"] = candidate.longitude

        # Create or update the matching incident in Convex.
        convex_incident_id = await convex_mutation(
            "incidents:upsertFromBackend",
            convex_incident,
        )
                # Build the Convex report data.
        convex_report = {
            "incidentId": convex_incident_id,
            "reporterToken": reporter_token,
            "description": description,
            "category": category,
            "location": location,
            "duplicateEvidence": duplicate,
            "semanticSimilarity": best,
        }

        # Only send optional values when they exist.
        if latitude is not None:
            convex_report["latitude"] = latitude

        if longitude is not None:
            convex_report["longitude"] = longitude

        if image_storage_id is not None:
            convex_report["imageStorageId"] = image_storage_id

        if phash is not None:
            convex_report["imagePhash"] = phash

        if exif_dt is not None:
            convex_report["exifDatetime"] = exif_dt

        if exif_gps is not None:
            convex_report["exifGps"] = exif_gps

        # Save the report metadata in Convex.
        convex_report_id = await convex_mutation(
            "reports:create",
            convex_report,
        )

        return {
            "report": report.model_dump(),
            "incident": candidate.model_dump(),
            "convex_incident_id": convex_incident_id,
            "convex_report_id": convex_report_id,
            "image_storage_id": image_storage_id,
            "reasons": reasons,
        }


@app.post("/incidents/{incident_id}/confirm")
def confirm(incident_id: int):
    with Session(engine) as session:
        incident = session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(404, "Incident not found")
        incident.confirmations += 1
        session.add(incident)
        session.commit()
        reasons = recalc_incident(session, incident)
        return {**incident.model_dump(), "reasons": reasons}

@app.post("/incidents/{incident_id}/contradict")
def contradict(incident_id: int):
    with Session(engine) as session:
        incident = session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(404, "Incident not found")
        incident.contradictions += 1
        session.add(incident)
        session.commit()
        reasons = recalc_incident(session, incident)
        return {**incident.model_dump(), "reasons": reasons}
