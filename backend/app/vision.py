"""One Groq vision call per photo, with validated output and graceful fallback.

Previously each photo cost three separate requests (description, authenticity,
claim comparison) across two API keys. They are now one request whose JSON is
validated field by field; anything malformed becomes "unavailable" instead of
reaching Convex or the score.
"""
import base64
import json
import logging
import os
import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

log = logging.getLogger(__name__)
DEFAULT_MODEL = "qwen/qwen3.8-27b"

PROMPT = """You are reviewing a photo attached to a community incident report.

Reported claim:
{claim}

Return ONLY a JSON object with exactly these fields:
"summary": a short description of what is visibly present and relevant (max 2 sentences). Do not assume facts that cannot be seen.
"authenticity": {{"classification": "likely_real" | "uncertain" | "suspicious", "confidence": number 0-1, "reason": short explanation}} for visible signs of AI generation or digital manipulation. Never claim certainty from visual inspection alone.
"visualComparison": {{"match": "yes" | "partial" | "no" | "unavailable", "confidence": number 0-1, "reason": short explanation}} judging only whether visible evidence is consistent with the claim. A photo need not prove the whole claim to be "partial". Use "unavailable" when there is no claim."""


def _unit(value):
    # Models sometimes return "0.8", 80 or 1.4; coerce, rescale percentages and clamp.
    number = float(value)
    if number > 1 and number <= 100:
        number /= 100
    return max(0.0, min(1.0, number))


class _Assessment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    confidence: float
    reason: str = ""

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, value):
        return _unit(value)

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, value):
        return str(value or "")[:1000]


class Authenticity(_Assessment):
    classification: Literal["likely_real", "uncertain", "suspicious"]


class VisualComparison(_Assessment):
    match: Literal["yes", "partial", "no", "unavailable"]


class VisionResult(BaseModel):
    """Response of POST /evidence/analyze. Missing parts are null, never invented."""
    status: Literal["ok", "unavailable"]
    summary: Optional[str] = None
    authenticity: Optional[Authenticity] = None
    visualComparison: Optional[VisualComparison] = None
    detail: Optional[str] = None


def unavailable(detail: str) -> VisionResult:
    return VisionResult(status="unavailable", detail=detail)


def api_key() -> Optional[str]:
    # GROQ_QWEN_API_KEY is accepted for existing .env files; only one key is needed.
    return os.getenv("GROQ_API_KEY") or os.getenv("GROQ_QWEN_API_KEY") or None


def parse_model_output(text: str) -> VisionResult:
    """Validate each part independently so one bad field does not discard the rest."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    try:
        data = json.loads(match.group(0) if match else cleaned)
    except (json.JSONDecodeError, TypeError):
        return unavailable("The vision model did not return valid JSON.")
    if not isinstance(data, dict):
        return unavailable("The vision model did not return a JSON object.")

    def part(model, value):
        try:
            return model.model_validate(value) if isinstance(value, dict) else None
        except (ValidationError, ValueError, TypeError):
            return None

    summary = data.get("summary")
    result = VisionResult(
        status="ok",
        summary=summary.strip()[:2000] if isinstance(summary, str) and summary.strip() else None,
        authenticity=part(Authenticity, data.get("authenticity")),
        visualComparison=part(VisualComparison, data.get("visualComparison") or data.get("visual_comparison")),
    )
    if not (result.summary or result.authenticity or result.visualComparison):
        return unavailable("The vision model returned no usable fields.")
    return result


def analyze(image: bytes, mime_type: str, claim: str, client=None) -> VisionResult:
    key = api_key()
    if not key and client is None:
        return unavailable("Vision analysis is not configured (GROQ_API_KEY is not set).")
    try:
        if client is None:
            from groq import Groq
            client = Groq(api_key=key, timeout=float(os.getenv("GROQ_TIMEOUT_SECONDS", "30")), max_retries=1)
        encoded = base64.b64encode(image).decode("ascii")
        completion = client.chat.completions.create(
            model=os.getenv("GROQ_VISION_MODEL", DEFAULT_MODEL),
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT.format(claim=claim.strip()[:2000] or "(no claim provided)")},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}},
                ],
            }],
            reasoning_effort="none",
            temperature=0.1,
            max_completion_tokens=500,
        )
        return parse_model_output(completion.choices[0].message.content or "")
    except Exception as error:  # Network, quota or SDK errors must not fail the report.
        log.warning("Vision analysis failed: %s", type(error).__name__)
        return unavailable("Vision analysis is temporarily unavailable.")
