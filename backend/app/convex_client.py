import os
import httpx
from dotenv import load_dotenv

load_dotenv()

CONVEX_URL = os.getenv("CONVEX_URL")


def _require_convex_url() -> str:
    if not CONVEX_URL:
        raise RuntimeError(
            "CONVEX_URL is not set. Set it to your Convex deployment URL."
        )
    return CONVEX_URL.rstrip("/")


async def convex_mutation(path: str, args: dict):
    """Call a public Convex mutation over HTTP."""
    url = f"{_require_convex_url()}/api/mutation"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            url,
            json={
                "path": path,
                "args": args,
                "format": "json",
            },
        )
        response.raise_for_status()

        data = response.json()

        if data.get("status") == "error":
            raise RuntimeError(
                f"Convex mutation {path} failed: {data.get('errorMessage')}"
            )

        return data.get("value")


async def generate_upload_url() -> str:
    """Ask Convex Storage for a temporary photo upload URL."""
    return await convex_mutation("reports:generateUploadUrl", {})


async def upload_image(image_bytes: bytes, content_type: str) -> str:
    """Upload image bytes to Convex Storage and return the storage ID."""
    upload_url = await generate_upload_url()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            upload_url,
            content=image_bytes,
            headers={
                "Content-Type": content_type or "application/octet-stream"
            },
        )
        response.raise_for_status()

        data = response.json()
        return data["storageId"]
