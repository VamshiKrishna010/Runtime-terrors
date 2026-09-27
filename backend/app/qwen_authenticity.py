import base64
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_QWEN_API_KEY = os.getenv("GROQ_QWEN_API_KEY")


def analyze_image_authenticity(image_path: str) -> dict:
    """Use Qwen vision to assess visible signs of image manipulation or generation."""
    if not GROQ_QWEN_API_KEY:
        raise RuntimeError("GROQ_QWEN_API_KEY is not set.")

    path = Path(image_path)

    with open(path, "rb") as image_file:
        encoded_image = base64.b64encode(image_file.read()).decode("utf-8")

    mime_types = {
        ".png": "image/png",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    mime_type = mime_types.get(path.suffix.lower(), "image/jpeg")

    client = Groq(api_key=GROQ_QWEN_API_KEY)

    completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Assess this image for visible signs that it may be "
                            "AI-generated or digitally manipulated. Do not claim "
                            "certainty from visual inspection alone. Return ONLY "
                            "valid JSON with these fields: "
                            '"classification" ("likely_real", "uncertain", or '
                            '"suspicious"), "confidence" (number from 0 to 1), '
                            'and "reason" (a short explanation).'
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{encoded_image}"
                        },
                    },
                ],
            }
        ],
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

    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {
            "classification": "uncertain",
            "confidence": 0.0,
            "reason": "The authenticity model did not return valid structured output.",
        }
