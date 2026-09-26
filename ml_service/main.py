"""Runnable setup skeleton; inference and scoring arrive in later blocks."""

from fastapi import FastAPI, HTTPException

from .config import (
    CLUSTER_SIMILARITY_THRESHOLD,
    CLUSTER_WINDOW_SECONDS,
    EMBEDDING_DIMENSION,
    MODEL_ID,
)
from .schemas import EmbedRequest, EmbedResponse, PendingResponse, ScoreRequest, ScoreResponse

app = FastAPI(
    title="VeriPulse ML Service",
    version="0.1.0",
    description="Setup skeleton. /embed and /score validate input but return HTTP 501 until implemented.",
)


@app.get("/health")
def health():
    """Liveness and capability status; ok does not indicate inference readiness."""
    return {
        "ok": True,
        "stage": "skeleton",
        "model": MODEL_ID,
        "dimensions": EMBEDDING_DIMENSION,
        "model_loaded": False,
        "capabilities": {"embed": False, "score": False},
        "cluster_window_seconds": CLUSTER_WINDOW_SECONDS,
        "cluster_similarity_threshold": CLUSTER_SIMILARITY_THRESHOLD,
    }


@app.post("/embed", response_model=EmbedResponse, responses={501: {"model": PendingResponse}})
def embed(payload: EmbedRequest):
    """Future output: one normalized 384-dimensional vector per input, in order."""
    raise HTTPException(501, detail={
        "code": "not_implemented",
        "capability": "embed",
        "message": "Model selected; embedding inference is scheduled for the core block.",
    })


@app.post("/score", response_model=ScoreResponse, responses={501: {"model": PendingResponse}})
def score(payload: ScoreRequest):
    """Future output: support score, evidence level, and contribution reasons."""
    raise HTTPException(501, detail={
        "code": "not_implemented",
        "capability": "score",
        "message": "Scoring contract defined; weighted scoring is scheduled for the integration block.",
    })
