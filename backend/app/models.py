from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

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
