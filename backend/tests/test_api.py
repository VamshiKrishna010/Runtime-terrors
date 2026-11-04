import io
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from app import vision
from app.main import create_app
from app.rate_limit import AnalyzeLimiter


def image_bytes(fmt="JPEG"):
    buffer = io.BytesIO()
    Image.new("RGB", (48, 32), "navy").save(buffer, format=fmt)
    return buffer.getvalue()


class FakeGroq:
    """Stands in for the Groq SDK client and records every request."""

    def __init__(self, content='{}', error=None):
        self.calls = []
        self.content, self.error = content, error
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))])


GOOD = """```json
{"summary": "A wet floor near a doorway.",
 "authenticity": {"classification": "likely_real", "confidence": 0.82, "reason": "Natural lighting."},
 "visualComparison": {"match": "partial", "confidence": "0.6", "reason": "Water is visible."}}
```"""


class AnalyzeTests(unittest.TestCase):
    def client(self, fake=None, limiter=None):
        client = TestClient(create_app(limiter=limiter or AnalyzeLimiter(100, 1000), vision_client=fake))
        self.addCleanup(client.close)
        return client

    def post(self, client, data=None, description="Water leaking in the library", content_type="image/jpeg"):
        return client.post("/evidence/analyze", data={"description": description},
                           files={"image": ("photo.jpg", data if data is not None else image_bytes(), content_type)})

    def test_single_vision_call_with_validated_output(self):
        fake = FakeGroq(GOOD)
        response = self.post(self.client(fake))
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake.calls), 1, "one model request per photo")
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["summary"], "A wet floor near a doorway.")
        self.assertEqual(body["authenticity"]["classification"], "likely_real")
        self.assertEqual(body["visualComparison"], {"match": "partial", "confidence": 0.6, "reason": "Water is visible."})
        self.assertIn("Water leaking in the library", fake.calls[0]["messages"][0]["content"][0]["text"])

    def test_malformed_model_output_is_rejected_field_by_field(self):
        content = '{"summary": "ok", "authenticity": {"classification": "definitely_fake", "confidence": 2}, "visualComparison": {"match": "yes", "confidence": 140, "reason": 5}}'
        result = vision.parse_model_output(content)
        self.assertIsNone(result.authenticity)  # unknown classification dropped
        self.assertEqual(result.visualComparison.confidence, 1.0)  # 140 -> 1.4 clamped to 1
        self.assertEqual(result.visualComparison.reason, "5")
        self.assertEqual(vision.parse_model_output("not json").status, "unavailable")
        self.assertEqual(vision.parse_model_output('{"authenticity": {"confidence": "high"}}').status, "unavailable")

    def test_missing_key_degrades_instead_of_500(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": "", "GROQ_QWEN_API_KEY": ""}):
            response = self.post(self.client())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unavailable")
        self.assertIn("not configured", response.json()["detail"])

    def test_model_errors_degrade(self):
        response = self.post(self.client(FakeGroq(error=TimeoutError())))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unavailable")

    def test_invalid_uploads_rejected_before_any_model_call(self):
        fake = FakeGroq(GOOD)
        client = self.client(fake)
        self.assertEqual(self.post(client, b"not an image").status_code, 422)
        self.assertEqual(self.post(client, image_bytes("GIF"), content_type="image/gif").status_code, 422)
        self.assertEqual(self.post(client, b"x" * (10 * 1024 * 1024 + 1)).status_code, 413)
        self.assertEqual(self.post(client, image_bytes("PNG"), content_type="image/png").status_code, 200)
        self.assertEqual(len(fake.calls), 1)

    def test_rate_limits_per_client_and_globally(self):
        now = [0.0]
        fake = FakeGroq(GOOD)
        client = self.client(fake, AnalyzeLimiter(per_client_per_minute=2, global_per_hour=3, clock=lambda: now[0]))
        self.assertEqual(self.post(client).status_code, 200)
        self.assertEqual(self.post(client).status_code, 200)
        limited = self.post(client)
        self.assertEqual(limited.status_code, 429)
        self.assertIn("Retry-After", limited.headers)
        now[0] = 61
        self.assertEqual(self.post(client).status_code, 200)
        now[0] = 200
        self.assertEqual(self.post(client).status_code, 429, "global hourly budget")
        self.assertEqual(len(fake.calls), 3, "rejected requests never reach Groq")

    def test_proxy_headers_only_trusted_when_enabled(self):
        from app.rate_limit import client_key
        request = SimpleNamespace(headers={"cf-connecting-ip": "203.0.113.9"}, client=SimpleNamespace(host="10.0.0.2"))
        self.assertEqual(client_key(request), "10.0.0.2")
        with patch.dict(os.environ, {"TRUST_PROXY_HEADERS": "1"}):
            self.assertEqual(client_key(request), "203.0.113.9")

    def test_health_and_cors(self):
        client = self.client(FakeGroq())
        self.assertTrue(client.get("/health").json()["ok"])
        allowed = client.options("/evidence/analyze", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173")
        denied = client.options("/evidence/analyze", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertNotIn("access-control-allow-origin", denied.headers)


if __name__ == "__main__":
    unittest.main()
