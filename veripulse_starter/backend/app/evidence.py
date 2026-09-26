from pathlib import Path
from PIL import Image, ExifTags
import imagehash

GPS_TAG = next((k for k, v in ExifTags.TAGS.items() if v == "GPSInfo"), None)
DT_TAGS = {k for k, v in ExifTags.TAGS.items() if v in {"DateTime", "DateTimeOriginal", "DateTimeDigitized"}}

def analyze_image(path: str) -> dict:
    result = {"phash": None, "exif_datetime": None, "exif_gps": None}
    try:
        img = Image.open(path)
        result["phash"] = str(imagehash.phash(img))
        exif = img.getexif()
        for tag in DT_TAGS:
            if tag in exif and not result["exif_datetime"]:
                result["exif_datetime"] = str(exif.get(tag))
        if GPS_TAG and GPS_TAG in exif:
            result["exif_gps"] = str(exif.get(GPS_TAG))
    except Exception:
        pass
    return result

def phash_distance(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    try:
        return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)
    except Exception:
        return None
