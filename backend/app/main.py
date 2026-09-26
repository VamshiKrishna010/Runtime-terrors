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
            reports = session.exec(select(Report).where(Report.incident_id == inc.id)).all()
            texts = [r.description for r in reports]
            sim = best_similarity(description, texts)
            same_place = location.strip().lower() == inc.location.strip().lower()
            if same_place and sim > best:
                best, candidate = sim, inc

        # Conservative threshold for joining an existing incident.
        if candidate is None or best < 0.20:
            candidate = Incident(title=description[:70], category=category, location=location,
                                 latitude=latitude, longitude=longitude)
            session.add(candidate)
            session.commit()
            session.refresh(candidate)
            best = 0.0

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

                # Also upload the same image to Convex Storage.
                image_storage_id = await upload_image(
                    image_bytes,
                    image.content_type or "application/octet-stream",
                )
                info = analyze_image(str(dest))
                phash, exif_dt, exif_gps = info["phash"], info["exif_datetime"], info["exif_gps"]

                if phash:
                    existing = session.exec(select(Report).where(Report.image_phash.is_not(None))).all()
                    for r in existing:
                        dist = phash_distance(phash, r.image_phash)
                        if dist is not None and dist <= 6:
                            duplicate = True
                            break
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
        return {"report": report.model_dump(), "incident": candidate.model_dump(), "reasons": reasons}

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
