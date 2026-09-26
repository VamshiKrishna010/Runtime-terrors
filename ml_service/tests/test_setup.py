import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from ml_service.main import app
from ml_service.validate_seed import SEED_PATH, validate_seed


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_health_distinguishes_liveness_from_model_readiness(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["model_loaded"])
        self.assertEqual(body["capabilities"], {"embed": False, "score": False})
        self.assertIsNone(body["cluster_similarity_threshold"])

    def test_valid_requests_return_explicit_pending_errors(self):
        for route, payload in (
            ("embed", {"texts": ["Wi-Fi drops in ITE."]}),
            ("score", {"distinct_reporters": 1, "semantic_agreement": 0.0}),
        ):
            with self.subTest(route=route):
                response = self.client.post(f"/{route}", json=payload)
                self.assertEqual(response.status_code, 501)
                self.assertEqual(response.json()["detail"]["capability"], route)

    def test_invalid_inputs_are_rejected_before_pending_response(self):
        cases = [
            ("embed", {"texts": []}),
            ("embed", {"texts": ["  "]}),
            ("embed", {"texts": ["a"] * 65}),
            ("embed", {"texts": ["a" * 2001]}),
            ("score", {"distinct_reporters": -1, "semantic_agreement": 0.5}),
            ("score", {"distinct_reporters": True, "semantic_agreement": 0.5}),
            ("score", {"distinct_reporters": 1, "semantic_agreement": 1.1}),
            ("score", {"distinct_reporters": 1, "semantic_agreement": 0.5, "typo": 2}),
        ]
        for route, payload in cases:
            with self.subTest(route=route, payload=payload):
                self.assertEqual(self.client.post(f"/{route}", json=payload).status_code, 422)

    def test_openapi_publishes_success_and_pending_contracts(self):
        schema = self.client.get("/openapi.json").json()
        for route in ("embed", "score"):
            responses = schema["paths"][f"/{route}"]["post"]["responses"]
            self.assertIn("200", responses)
            self.assertIn("501", responses)

    def test_seed_and_boundary_examples(self):
        self.assertEqual(validate_seed(), {"reports": 30, "clusters": 10, "pair_checks": 12})
        reports = {r["id"]: r for r in json.loads(SEED_PATH.read_text())["reports"]}
        self.assertEqual(reports["r01"]["description"], reports["r27"]["description"])
        self.assertNotEqual(reports["r01"]["expected_cluster_id"], reports["r27"]["expected_cluster_id"])

    def test_validator_catches_inconsistent_pair_label(self):
        dataset = json.loads(SEED_PATH.read_text())
        dataset["pair_checks"][0]["same_cluster"] = False
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reports.json"
            path.write_text(json.dumps(dataset), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "contradicts cluster labels"):
                validate_seed(path)


if __name__ == "__main__":
    unittest.main()
