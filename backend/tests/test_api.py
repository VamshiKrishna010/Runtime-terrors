import io
import os
from pathlib import Path
import sqlite3
from contextlib import closing
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, select

from app.main import create_app
from app.models import Evidence, Incident, Report
from app.evidence import inspect_bytes, time_consistency, location_consistency


def image_bytes(exif=None):
    buffer = io.BytesIO()
    image = Image.new("RGB", (48, 32), "navy")
    image.save(buffer, format="JPEG", **({"exif": exif} if exif else {}))
    return buffer.getvalue()


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = create_app(f"sqlite:///{self.root / 'test.db'}", self.root / 'uploads', allow_cleanup=True)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.data = {"reporter_token": "person-1", "description": "eduroam connection dropping in ITE", "category": "Network / IT", "location": "ITE Building"}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def submit(self, image=True, **fields):
        return self.client.post("/reports", data={**self.data, **fields}, files={"image": ("../../photo.jpg", image_bytes(), "image/jpeg")} if image else None)

    def test_full_flow_and_duplicates(self):
        response = self.submit(latitude="39.2553", longitude="-76.7113")
        self.assertEqual(response.status_code, 201, response.text)
        incident = response.json()["incident"]
        self.assertEqual(incident["report_count"], 1)
        self.assertEqual(incident["latitude"], 39.2553)
        iid = incident["id"]
        detail = self.client.get(f"/incidents/{iid}").json()
        self.assertEqual(detail["report_count"], 1)
        self.assertEqual(len(detail["evidence"]), 1)
        url = detail["reports"][0]["image_path"]
        self.assertEqual(self.client.get(url).content, image_bytes())
        items = self.client.get("/evidence").json()
        eid = items[0]["id"]
        self.assertEqual(items[0]["metadata"]["width"], 48)
        self.assertEqual(items[0]["metadata"]["exif_available"], False)
        self.assertEqual(items[0]["content_consistency"]["status"], "unavailable")
        self.assertEqual(items[0]["time_consistency"]["status"], "unavailable")
        self.assertEqual(len(items[0]["sha256_hash"]), 64)
        self.assertEqual(items[0]["support_contribution"], 4)
        review = self.client.patch(f"/evidence/{eid}/review", json={"review_state": "reviewed"})
        self.assertEqual(review.status_code, 200, review.text)
        self.assertEqual(self.client.get(f"/evidence/{eid}").json()["review_state"], "reviewed")
        vote = self.client.post(f"/incidents/{iid}/confirm", json={"reporter_token": "voter"}).json()
        self.assertEqual(vote["confirmations"], 1)
        self.assertGreater(vote["support_score"], incident["support_score"])
        self.assertEqual(self.client.post(f"/incidents/{iid}/confirm", json={"reporter_token": "voter"}).json()["confirmations"], 1)
        switched = self.client.post(f"/incidents/{iid}/contradict", json={"reporter_token": "voter"}).json()
        self.assertEqual((switched["confirmations"], switched["contradictions"]), (0, 1))
        self.assertEqual(self.client.post(f"/incidents/{iid}/confirm").json()["confirmations"], 1)
        duplicate = self.submit(reporter_token="person-2")
        self.assertEqual(duplicate.status_code, 201, duplicate.text)
        self.assertEqual(duplicate.json()["incident"]["id"], iid)
        self.assertEqual(duplicate.json()["incident"]["report_count"], 2)
        items = self.client.get("/evidence").json()
        self.assertEqual(items[0]["duplicate_analysis"]["status"], "Exact duplicate detected")
        self.assertEqual(items[0]["duplicate_analysis"]["duplicate_of"], eid)
        self.assertEqual(items[0]["support_contribution"], -12)
        self.assertEqual(self.client.get("/evidence/summary").json(), {"total_evidence": 2, "unique_images": 1, "duplicate_reused": 1, "metadata_conflicts": 0})
        self.assertEqual(len(self.client.get("/evidence", params={"status": "duplicate"}).json()), 1)
        self.assertEqual(len(self.client.get("/evidence", params={"search": "nonexistent"}).json()), 0)
        analytics = self.client.get("/analytics/summary").json()
        self.assertEqual(analytics["total_reports"], 2)
        self.assertEqual(analytics["report_volume_over_time"][0]["count"], 2)
        with Session(self.app.state.engine) as session:
            self.assertEqual(len(session.exec(select(Report)).all()), 2)
            self.assertEqual(session.get(Evidence, eid).review_state, "reviewed")
        removed = self.client.delete(f"/incidents/{iid}").json()
        self.assertEqual(removed["reports"], 2)
        self.assertEqual(removed["files_removed"], 2)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get("/incidents").json(), [])

    def test_validation_no_orphans_and_no_image(self):
        for fields in ({"description": " "}, {"category": "invalid"}, {"latitude": "2"}, {"latitude": "nan", "longitude": "0"}):
            self.assertEqual(self.submit(**fields).status_code, 422)
        bad = self.client.post("/reports", data=self.data, files={"image": ("evil.jpg", b"<script>bad</script>", "image/jpeg")})
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(self.client.get("/incidents").json(), [])
        one = self.submit(image=False)
        two = self.submit(image=False, reporter_token="person-2")
        self.assertEqual(two.status_code, 201, two.text)
        self.assertEqual(two.json()["incident"]["report_count"], 2)
        self.assertEqual(one.json()["incident"]["evidence"], [])
        separate = self.submit(image=False, category="Facilities")
        self.assertNotEqual(separate.json()["incident"]["id"], one.json()["incident"]["id"])
        self.assertEqual(self.client.get("/incidents/999").status_code, 404)
        self.assertEqual(self.client.get("/evidence/999").status_code, 404)
        self.assertEqual(self.client.patch("/evidence/999/review", json={"review_state": "invalid"}).status_code, 422)
        self.assertEqual(self.client.delete("/dev/incidents").json()["incidents"], 2)

    def test_write_failure_rolls_back(self):
        with patch("app.main.upload_path", side_effect=OSError("disk unavailable")):
            with self.assertRaises(OSError):
                self.submit()
        self.assertEqual(self.client.get("/incidents").json(), [])
        self.assertEqual(list((self.root / "uploads").iterdir()), [])

    def test_upload_limit_video_and_near_duplicate(self):
        with patch('app.main.MAX_UPLOAD_BYTES', 20):
            response = self.submit()
            self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get('/incidents').json(), [])
        first = self.submit().json()['incident']
        # Same pixels, different EXIF bytes: distinct SHA-256, same perceptual hash.
        exif = Image.Exif()
        exif[305] = 'Test editor'
        second = self.client.post('/reports', data={**self.data, 'reporter_token': 'second'},
            files={'image': ('edited.jpg', image_bytes(exif), 'image/jpeg')})
        self.assertEqual(second.status_code, 201, second.text)
        items = self.client.get('/evidence').json()
        self.assertNotEqual(items[0]['sha256_hash'], items[1]['sha256_hash'])
        self.assertEqual(items[0]['duplicate_analysis']['status'], 'Near-duplicate detected')
        self.assertEqual(items[0]['duplicate_analysis']['closest_duplicate_distance'], 0)
        video = b'\x00\x00\x00\x18ftypisom' + b'\x00' * 16
        result = self.client.post('/reports', data=self.data, files={'image': ('clip.mp4', video, 'video/mp4')})
        self.assertEqual(result.status_code, 201, result.text)
        item = self.client.get('/evidence').json()[0]
        self.assertEqual(item['type'], 'video')
        self.assertIsNone(item['perceptual_hash'])
        self.assertEqual(item['content_consistency']['status'], 'unavailable')

    def test_cleanup_keeps_referenced_files(self):
        first = self.submit().json()['incident']
        second = self.submit(image=False, category='Facilities').json()['incident']
        url = first['evidence'][0]['url']
        with Session(self.app.state.engine) as session:
            report = session.exec(select(Report).where(Report.incident_id == second['id'])).first()
            report.image_path = url
            session.add(report)
            session.commit()
        result = self.client.delete(f"/incidents/{first['id']}").json()
        self.assertEqual(result['files_removed'], 0)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.delete(f"/incidents/{second['id']}").json()['files_removed'], 1)

    def test_review_survives_new_application(self):
        self.submit()
        item = self.client.get('/evidence').json()[0]
        self.client.patch(f"/evidence/{item['id']}/review", json={'review_state': 'flagged'})
        another = create_app(f"sqlite:///{self.root / 'test.db'}", self.root / 'uploads')
        with TestClient(another) as client:
            self.assertEqual(client.get(f"/evidence/{item['id']}").json()['review_state'], 'flagged')

    def test_cors_and_production_cleanup_guard(self):
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            response = self.client.options("/reports", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
            self.assertEqual(response.headers["access-control-allow-origin"], origin)
        with patch.dict(os.environ, {"VERIPULSE_ENV": "production"}):
            prod = create_app(f"sqlite:///{self.root / 'prod.db'}", self.root / 'prod-uploads', allow_cleanup=True)
            with TestClient(prod) as client:
                self.assertEqual(client.delete("/dev/incidents").status_code, 404)
                self.assertEqual(client.delete("/incidents/1").status_code, 404)

    def test_real_exif_and_consistency(self):
        exif = Image.Exif()
        exif[271], exif[272], exif[305], exif[306] = "Test", "Camera", "Editor", "2026:09:26 20:00:00"
        info = inspect_bytes(image_bytes(exif))
        self.assertEqual(info["metadata"]["camera_device"], "Test Camera")
        self.assertEqual(info["metadata"]["editing_software"], "Editor")
        received = datetime.now(timezone.utc)
        self.assertEqual(time_consistency(received, info["metadata"]["capture_timestamp"])["status"], "needs_review")
        self.assertEqual(time_consistency(received, (received - timedelta(minutes=3)).isoformat())["status"], "consistent")
        self.assertEqual(time_consistency(received, (received - timedelta(days=90)).isoformat())["status"], "conflicting")
        report = Report(incident_id=1, reporter_token="x", description="x", category="Other", location="x", latitude=39.25, longitude=-76.71)
        self.assertEqual(location_consistency(report, {"gps_latitude": 39.25, "gps_longitude": -76.71})["status"], "consistent")
        self.assertEqual(location_consistency(report, {"gps_latitude": 40.25, "gps_longitude": -76.71})["status"], "conflicting")


class MigrationTests(unittest.TestCase):
    def test_existing_database_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / "legacy.db"
            # Match the existing Incident table before the additive migration.
            with closing(sqlite3.connect(db)) as connection:
                connection.execute("CREATE TABLE incident (id INTEGER PRIMARY KEY, title VARCHAR NOT NULL, category VARCHAR NOT NULL, location VARCHAR NOT NULL, latitude FLOAT, longitude FLOAT, created_at DATETIME NOT NULL, support_score FLOAT NOT NULL, evidence_level VARCHAR NOT NULL, confirmations INTEGER NOT NULL, contradictions INTEGER NOT NULL)")
                connection.execute("INSERT INTO incident VALUES (1, 'Existing incident', 'Other', 'ITE', NULL, NULL, '2026-09-26 20:00:00', 0, 'Low', 0, 0)")
                connection.commit()
            app = create_app(f"sqlite:///{db}", root / "uploads")
            with TestClient(app) as client:
                self.assertEqual(client.get("/incidents").json()[0]["title"], "Existing incident")
                self.assertEqual(client.get("/incidents").json()[0]["report_count"], 0)
                self.assertEqual(client.delete("/dev/incidents").status_code, 404)
            self.assertEqual(len(list(root.glob("*.bak"))), 1)
            with TestClient(app):
                pass
            self.assertEqual(len(list(root.glob("*.bak"))), 1)


if __name__ == "__main__":
    unittest.main()
