from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON, UniqueConstraint

class Incident(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    category: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: datetime = Field(
   	 default_factory=lambda: datetime.now(timezone.utc)
)    
    updated_at: Optional[datetime] = None
    support_score: float = 0
    evidence_level: str = "Low"
    confirmations: int = 0
    contradictions: int = 0

class Report(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    incident_id: int = Field(index=True)
    reporter_token: str = Field(index=True)
    description: str
    category: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: datetime = Field(    
         default_factory=lambda: datetime.now(timezone.utc)
)
    image_path: Optional[str] = None
    image_phash: Optional[str] = None
    exif_datetime: Optional[str] = None
    exif_gps: Optional[str] = None
    duplicate_evidence: bool = False
    semantic_similarity: float = 0


class Evidence(SQLModel, table=True):
    # Existing Report.image_path remains the compatibility URL for report clients.
    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="report.id", unique=True, index=True)
    incident_id: int = Field(foreign_key="incident.id", index=True)
    type: str = "image"
    original_filename: Optional[str] = None
    stored_filename: str
    mime_type: str
    file_size: int
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    sha256_hash: str = Field(index=True)
    perceptual_hash: Optional[str] = None
    metadata_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    source: str = "gallery_upload"
    review_state: str = "unreviewed"
    timeline: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class Vote(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("incident_id", "reporter_token"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    incident_id: int = Field(foreign_key="incident.id", index=True)
    reporter_token: str
    action: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
