"""File measurements only; no authenticity or visual AI inference."""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
import warnings

from PIL import Image
import imagehash

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
FORMATS = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"),
           "WEBP": (".webp", "image/webp"), "GIF": (".gif", "image/gif")}


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def iso(value):
    return utc(value).isoformat() if value else None


def gps_coordinate(parts, reference):
    value = float(parts[0]) + float(parts[1]) / 60 + float(parts[2]) / 3600
    return -value if reference in ("S", "W", b"S", b"W") else value


def inspect_bytes(data: bytes, declared_type: str = "") -> dict:
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Evidence must be nonempty and at most 10 MB")
    # Video container identification only: no codec, EXIF or visual inference.
    if declared_type == "video/mp4" and len(data) >= 24 and data[4:8] == b"ftyp":
        return {"suffix": ".mp4", "mime_type": "video/mp4", "type": "video",
                "sha256_hash": sha256(data).hexdigest(), "phash": None,
                "metadata": {"exif_available": False, "file_format": "MP4"}}
    if declared_type == "video/webm" and data.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in data[:4096]:
        return {"suffix": ".webm", "mime_type": "video/webm", "type": "video",
                "sha256_hash": sha256(data).hexdigest(), "phash": None,
                "metadata": {"exif_available": False, "file_format": "WebM"}}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in FORMATS:
                    raise ValueError("Supported images: JPEG, PNG, WebP and GIF")
                if image.width * image.height > 25_000_000:
                    raise ValueError("Images must be at most 25 megapixels")
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
                suffix, mime = FORMATS[image.format]
                metadata = {"width": image.width, "height": image.height,
                            "file_format": image.format, "exif_available": False}
                try:
                    exif = image.getexif()
                    metadata["exif_available"] = bool(exif)
                    tags = dict(exif)
                    if 34665 in exif:
                        tags.update(exif.get_ifd(34665))
                    metadata["camera_device"] = " ".join(str(tags.get(k, "")).strip() for k in (271, 272)).strip() or None
                    metadata["editing_software"] = str(tags[305]) if tags.get(305) else None
                    captured = tags.get(36867) or tags.get(306)
                    metadata["capture_timestamp"] = None
                    if captured:
                        try:
                            dt = datetime.strptime(str(captured), "%Y:%m:%d %H:%M:%S")
                            offset = tags.get(36881) or tags.get(36880)
                            metadata["capture_timestamp"] = dt.isoformat() + (str(offset) if offset else "")
                            # Validate before accepting metadata supplied by an untrusted file.
                            datetime.fromisoformat(metadata["capture_timestamp"])
                        except (ValueError, TypeError):
                            metadata["capture_timestamp"] = None
                    if 34853 in exif:
                        gps = exif.get_ifd(34853)
                        lat = gps_coordinate(gps[2], gps[1])
                        lon = gps_coordinate(gps[4], gps[3])
                        if -90 <= lat <= 90 and -180 <= lon <= 180:
                            metadata.update(gps_latitude=lat, gps_longitude=lon)
                except (KeyError, TypeError, ValueError, ZeroDivisionError, OSError):
                    metadata["extraction_warning"] = "Some metadata could not be read"
                return {"suffix": suffix, "mime_type": mime, "type": "image",
                        "sha256_hash": sha256(data).hexdigest(),
                        "phash": str(imagehash.phash(image)), "metadata": metadata}
    except (OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("Invalid or unsupported image; use JPEG, PNG, WebP, GIF, MP4 or WebM") from error


def analyze_image(path: str) -> dict:
    info = inspect_bytes(Path(path).read_bytes())
    return {"phash": info["phash"], "exif_datetime": info["metadata"].get("capture_timestamp"),
            "exif_gps": None, **info}


def phash_distance(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    try:
        return int(imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b))
    except (ValueError, TypeError):
        return None


def time_consistency(reported_at, captured_at):
    result = {"reported_at": iso(reported_at), "captured_at": captured_at,
              "difference_seconds": None, "status": "unavailable"}
    if not captured_at:
        return result
    try:
        capture = datetime.fromisoformat(captured_at)
    except ValueError:
        return result
    if capture.tzinfo is None:
        return {**result, "status": "needs_review", "note": "EXIF time has no timezone; difference cannot be established"}
    delta = (utc(reported_at) - utc(capture)).total_seconds()
    # Up to 1 hour old and 5 minutes clock skew: consistent. Beyond 24h old
    # or over 1h in the future: conflicting. Middle range requires review.
    status = "consistent" if -300 <= delta <= 3600 else "conflicting" if delta > 86400 or delta < -3600 else "needs_review"
    return {**result, "difference_seconds": round(delta), "status": status}


def location_consistency(report, metadata):
    lat, lon = metadata.get("gps_latitude"), metadata.get("gps_longitude")
    result = {"reported_coordinates": None, "evidence_coordinates": None,
              "distance_meters": None, "status": "unavailable"}
    if report.latitude is not None and report.longitude is not None:
        result["reported_coordinates"] = {"latitude": report.latitude, "longitude": report.longitude}
    if lat is not None and lon is not None:
        result["evidence_coordinates"] = {"latitude": lat, "longitude": lon}
    if not result["reported_coordinates"] or not result["evidence_coordinates"]:
        return result
    a, b = radians(report.latitude), radians(lat)
    dlat, dlon = b - a, radians(lon - report.longitude)
    hav = sin(dlat / 2)**2 + cos(a)*cos(b)*sin(dlon / 2)**2
    distance = 6371000 * 2 * atan2(sqrt(max(0, hav)), sqrt(max(0, 1-hav)))
    # Coarse campus-scale thresholds, not identity/location verification.
    status = "consistent" if distance <= 150 else "needs_review" if distance <= 1000 else "conflicting"
    return {**result, "distance_meters": round(distance, 1), "status": status}
