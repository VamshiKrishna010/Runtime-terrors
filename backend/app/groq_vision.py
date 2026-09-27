import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")


def analyze_image_with_groq(image_path: str) -> str:
    """Analyze report photo evidence using Groq Vision."""

    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set.")

    path = Path(image_path)

    with open(path, "rb") as image_file:
        base64_image = base64.b64encode(
            image_file.read()
        ).decode("utf-8")

    suffix = path.suffix.lower()

    if suffix == ".png":
        mime_type = "image/png"
    elif suffix == ".webp":
        mime_type = "image/webp"
    else:
        mime_type = "image/jpeg"

    client = Groq(api_key=GROQ_API_KEY)

    completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {
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
                            "url": (
                                f"data:{mime_type};base64,"
                                f"{base64_image}"
                            )
                        },
                    },
                ],
            }
        ],
        reasoning_effort="none",
        temperature=0.2,
        max_completion_tokens=300,
    )

    return completion.choices[0].message.content or ""