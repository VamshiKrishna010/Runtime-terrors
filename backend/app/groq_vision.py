import base64
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")


def _image_data(image_path: str):
    path = Path(image_path)

    with open(path, "rb") as image_file:
        base64_image = base64.b64encode(image_file.read()).decode("utf-8")

    mime_types = {
        ".png": "image/png",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }

    return base64_image, mime_types.get(path.suffix.lower(), "image/jpeg")


def analyze_image_with_groq(image_path: str) -> str:
    """Describe visible evidence in a report photo."""
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set.")

    base64_image, mime_type = _image_data(image_path)
    client = Groq(api_key=GROQ_API_KEY)

    completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Analyze this photo as evidence for an incident report. "
                        "Briefly describe only what is visibly present and relevant. "
                        "Do not assume facts that cannot be determined from the image."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime_type};base64,{base64_image}"
                    },
                },
            ],
        }],
        reasoning_effort="none",
        temperature=0.2,
        max_completion_tokens=300,
    )

    return completion.choices[0].message.content or ""


def compare_image_to_claim(image_path: str, claim: str) -> dict:
    """Compare visible image evidence with the reporter's written claim."""

    fallback = {
        "match": "unavailable",
        "confidence": 0.0,
        "reason": "Visual comparison was unavailable.",
    }

    if not GROQ_API_KEY or not claim.strip():
        return fallback

    try:
        base64_image, mime_type = _image_data(image_path)
        client = Groq(api_key=GROQ_API_KEY)

        completion = client.chat.completions.create(
            model="qwen/qwen3.8-27b",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Compare the uploaded image with this incident report claim:\n\n"
                            f"{claim}\n\n"
                            "Judge ONLY whether visible evidence in the image is "
                            "consistent with the claim. Do not invent details that "
                            "cannot be seen. A photo does not need to prove the entire "
                            "claim to be partially consistent.\n\n"
                            "Return ONLY valid JSON with these fields:\n"
                            '"match": one of "yes", "partial", "no", or "unavailable",\n'
                            '"confidence": a number from 0 to 1,\n'
                            '"reason": a short explanation.'
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{base64_image}"
                        },
                    },
                ],
            }],
            reasoning_effort="none",
            temperature=0.1,
            max_completion_tokens=250,
        )

        response = (completion.choices[0].message.content or "").strip()

        if response.startswith("```"):
            lines = response.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            response = "\n".join(lines).strip()

        result = json.loads(response)

        if result.get("match") not in {"yes", "partial", "no", "unavailable"}:
            return fallback

        confidence = float(result.get("confidence", 0))
        confidence = max(0.0, min(1.0, confidence))

        return {
            "match": result["match"],
            "confidence": confidence,
            "reason": str(result.get("reason", ""))[:1000],
        }

    except Exception:
        # Model/API failure must not prevent a report from being submitted.
        return fallback
