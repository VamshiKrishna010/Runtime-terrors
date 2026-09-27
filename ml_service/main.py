"""MiniLM embedding and interpretable evidence-scoring service."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import (
    CLUSTER_SIMILARITY_THRESHOLD,
    CLUSTER_WINDOW_SECONDS,
    EMBEDDING_DIMENSION,
    MODEL_ID,
)
from .schemas import EmbedRequest, EmbedResponse, PendingResponse, ScoreRequest, ScoreResponse
from .embedding import embed_texts, model_loaded
from .scoring import score_evidence

app = FastAPI(
    title="VeriPulse ML Service",
    version="0.1.0",
    description="Normalized MiniLM embeddings and interpretable evidence scoring.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "ML_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if origin.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health():
    """Liveness and capability status; ok does not indicate inference readiness."""
    return {
        "ok": True,
        "stage": "ready",
        "model": MODEL_ID,
        "dimensions": EMBEDDING_DIMENSION,
        "model_loaded": model_loaded(),
        "capabilities": {"embed": True, "score": True},
        "cluster_window_seconds": CLUSTER_WINDOW_SECONDS,
        "cluster_similarity_threshold": CLUSTER_SIMILARITY_THRESHOLD,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(payload: EmbedRequest):
    return EmbedResponse(model=MODEL_ID, embeddings=embed_texts(payload.texts))


@app.post("/score", response_model=ScoreResponse)
def score(payload: ScoreRequest):
    return score_evidence(payload)
