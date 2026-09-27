import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from ml_service.main import app
from ml_service.validate_seed import SEED_PATH, validate_seed


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_health_advertises_available_capabilities_before_model_load(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["model_loaded"])
        self.assertEqual(body["capabilities"], {"embed": True, "score": True})
        self.assertEqual(body["cluster_similarity_threshold"], 0.32)

    @patch("ml_service.main.embed_texts", return_value=[[1.0] + [0.0] * 383])
    def test_embed_returns_normalized_vectors(self, _embed):
        response = self.client.post("/embed", json={"texts": ["Wi-Fi drops in ITE."]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["dimensions"], 384)
        self.assertEqual(response.json()["embeddings"][0][0], 1.0)

    def test_score_returns_interpretable_contributions(self):
        response = self.client.post("/score", json={
            "distinct_reporters": 2,
            "semantic_agreement": 0.8,
            "confirmations": 1,
            "time_proximity": 1,
            "location_consistency": 1,
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["support_score"], 71)
        self.assertEqual(body["evidence_level"], "Strong")
        self.assertTrue(any("Semantic agreement 80%" in reason for reason in body["reasons"]))

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

    def test_openapi_publishes_success_contracts(self):
        schema = self.client.get("/openapi.json").json()
        for route in ("embed", "score"):
            responses = schema["paths"][f"/{route}"]["post"]["responses"]
            self.assertIn("200", responses)

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
