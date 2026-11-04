"""Validate uploaded photos before they are sent to the vision model."""
from io import BytesIO
import warnings

from PIL import Image

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 25_000_000
FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def inspect_image(data: bytes) -> str:
    """Return the verified MIME type, or raise ValueError for anything unsafe."""
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Photos must be nonempty and at most 10 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in FORMATS:
                    raise ValueError("Photos must be JPEG, PNG or WebP")
                if image.width * image.height > MAX_PIXELS:
                    raise ValueError("Photos must be at most 25 megapixels")
                image.verify()
                return FORMATS[image.format]
    except (OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("Invalid or unsupported image; use JPEG, PNG or WebP") from error
