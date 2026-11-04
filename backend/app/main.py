"""VeriPulse vision-analysis service.

Convex is the single source of truth for reports, incidents, votes, evidence
review, scoring and analytics. This service is stateless and optional: it
holds the Groq key, runs one vision request per photo and returns validated
JSON. It never stores the photo. If it is offline or unconfigured, reports
still submit; they just carry no vision result.
"""
import math
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from . import vision
from .evidence import MAX_UPLOAD_BYTES, inspect_image
from .rate_limit import AnalyzeLimiter, client_key

load_dotenv()


def create_app(limiter=None, vision_client=None):
    app = FastAPI(title="VeriPulse vision analysis")
    app.state.limiter = limiter or AnalyzeLimiter()
    origins = [origin.strip() for origin in os.getenv("VERIPULSE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.get("/health")
    def health():
        return {"ok": True, "vision_configured": bool(vision.api_key() or vision_client)}

    @app.post("/evidence/analyze", response_model=vision.VisionResult)
    async def analyze_evidence(request: Request, image: UploadFile = File(...), description: str = Form("", max_length=4000)):
        wait = app.state.limiter.check(client_key(request))
        if wait:
            raise HTTPException(429, "Too many analysis requests. Please wait and try again.",
                                headers={"Retry-After": str(math.ceil(wait))})
        try:
            data = await image.read(MAX_UPLOAD_BYTES + 1)
        finally:
            await image.close()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Photos must be at most 10 MB")
        try:
            mime_type = inspect_image(data)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        # Held in memory only; nothing is written to disk.
        return await run_in_threadpool(vision.analyze, data, mime_type, description, vision_client)

    return app


app = create_app()
