# VeriPulse ML setup

Owner: Vamshi. MiniLM embeddings and interpretable evidence scoring for the
report-clustering flow.

## Status

- Selected model: `sentence-transformers/all-MiniLM-L6-v2`.
- Dataset: `data/reports.json`, 30 reports across 10 expected incidents, with 12 explicit pair checks.
- Working routes: `GET /health`, `POST /embed`, and `POST /score`.
- MiniLM loads lazily on the first `/embed` request and returns normalized
  384-dimensional vectors.
- The 30-report fixture calibrates cosine similarity to `0.32`; category,
  canonical location, and a two-hour window remain mandatory cluster guards.
- `/score` returns the weighted score and the reasons displayed in the UI.

This service is separate from the vision-analysis service in `backend/`.
Its default development port is 8001.

**How the live app uses it.** Clustering and scoring run inside Convex. The
browser computes the description embedding, either through this service's
`/embed` (when `VITE_ML_SERVICE_URL` is set, as in Docker Compose) or with the
same MiniLM model running in the browser via transformers.js (the default, and
what the static GitHub Pages build uses). `/score` mirrors the canonical scorer
in `frontend/convex/lib/scoring.ts` for offline evaluation; the live app never
calls it, and clients can no longer write scores.

## Model decision

Use the model already selected in the team build plan. Its
[official model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
documents 384-dimensional sentence embeddings suitable for clustering, an
Apache-2.0 license, and default truncation after 256 word pieces.

The service loads one SentenceTransformer instance per process on CPU and calls
`encode(texts, normalize_embeddings=True)`. Output order matches input order.
The first embedding request downloads the model weights if needed. The
2,000-character request limit is an API bound, not a guarantee that the model
will encode every token.

Cosine similarity compares descriptions. Canonical building and time are separate
eligibility checks owned by the clustering integration. Do not merge two incidents
solely because their descriptions are similar. Use a two-hour candidate window;
the exact incident timestamp anchor should be agreed with Jas before integration.
`CLUSTER_SIMILARITY_THRESHOLD` is `0.32`, selected by
`python -m ml_service.evaluate_seed`. Do not reuse the old backend's 0.20
word-overlap threshold for cosine similarity.

## Run from the repository root

PowerShell, using Python 3.12 or newer:

```powershell
python -m venv ml_service/.venv
ml_service/.venv/Scripts/python.exe -m pip install -r ml_service/requirements-dev.txt
ml_service/.venv/Scripts/python.exe -m uvicorn ml_service.main:app --reload --port 8001
```

On macOS/Linux, use `ml_service/.venv/bin/python` for the last two commands.
For a runtime-only install, use `requirements.txt` instead of `requirements-dev.txt`.
Open http://localhost:8001/docs to inspect and try the contracts.

In another PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:8001/health
ml_service/.venv/Scripts/python.exe -m ml_service.validate_seed
ml_service/.venv/Scripts/python.exe -m unittest discover -s ml_service/tests -v
```

The validator checks fixture consistency. Tests mock the model and do not
download weights or modify the app database. Run
`python -m ml_service.evaluate_seed` for the local threshold evaluation.

## Proposed API contracts for Jas

OpenAPI is generated from `schemas.py`; unknown request fields are rejected with
HTTP 422. The local frontend calls this service directly, so the default CORS
origins include Vite on port 5173. Set `ML_CORS_ORIGINS` when hosting it.

### POST /embed

Request: 1-64 nonblank descriptions, at most 2,000 characters each.

```json
{"texts": ["Wi-Fi keeps dropping in ITE.", "Eduroam disconnects upstairs."]}
```

Success response fields:

| Field | Meaning |
| --- | --- |
| `model` | `sentence-transformers/all-MiniLM-L6-v2` |
| `dimensions` | `384` |
| `normalized` | `true` |
| `embeddings` | One L2-normalized array of 384 floats per input, in input order |

The vectors are produced by MiniLM; no placeholder vectors are returned.

### POST /score

```json
{
  "distinct_reporters": 3,
  "semantic_agreement": 0.8,
  "confirmations": 2,
  "contradictions": 0,
  "unique_images": 1,
  "duplicate_images": 0,
  "metadata_conflicts": 0,
  "time_proximity": 1,
  "visual_match": "unavailable"
}
```

Counts must be nonnegative integers; `semantic_agreement` and `time_proximity`
must be within [0, 1]. Unknown fields are rejected. `location_consistency` was
removed: clustering already requires the same location, so it awarded every
incident free points. `time_proximity` counts *other* reports within 30 minutes
of the newest one (0 for a lone report, 0.5 for one, 1 for two or more).

| Signal | Points |
| --- | --- |
| Distinct reporter tokens | +12 each, cap +36 |
| Semantic agreement (mean cosine of clustered reports) | up to +30 |
| Community confirmations | +5 each, cap +20 |
| Unique images | +4 each, cap +12 |
| Corroborating reports within 30 min | up to +10 |
| Visual match (latest available) | yes +8, partial +4, no -4 |
| Reused images (pHash Hamming <= 6 or same SHA-256) | -12 each, cap -36 |
| Metadata conflicts (EXIF time or GPS) | -8 each, cap -24 |
| Community contradictions | -7 each, cap -28 |

Clamped to 0-100. Strong >= 65, Emerging >= 35, otherwise Low. Rounding is
half-up in both implementations. `shared/scoring_cases.json` is checked against
this scorer and the Convex one in CI, so changing a weight means changing both.
The score measures support, not probability of truth.

### Photo analysis

EXIF and pHash are read in the browser from the original file, Convex strips
the file's metadata before storing it, and `backend/` makes one Groq vision
request per photo. See the root README.

## Seed set

The JSON contains fictional data for development, not reports of actual events.
Each report has `id`, `reporter_token`, `description`, `category`, canonical
`location`, timezone-aware `reported_at`, and `expected_cluster_id`.
Expected labels are evaluation targets and must never be included in embedding
inputs or inference decisions. Fixture IDs and timestamps are stable.

| Expected incident | Reports |
| --- | --- |
| ITE afternoon Wi-Fi outage | r01-r04 |
| ITE east elevator failure | r05-r08 |
| Library ceiling leak | r09-r12 |
| Commons cooling failure | r13-r16 |
| Library ramp obstruction | r17-r20 |
| ITE printer jam | r21-r24 |
| Library Wi-Fi outage | r25-r26 |
| ITE evening Wi-Fi outage | r27-r28 |
| Commons sink leak | r29 |
| Library automatic door failure | r30 |

Same-location/same-category negatives distinguish a printer jam from a Wi-Fi
outage and a blocked ramp from a broken door. Location negatives distinguish
similar outages at ITE and the library. r01 and r27 intentionally have identical
text but are over two hours apart, requiring a temporal eligibility check.
Descriptions include building aliases, while the location field stays canonical.

For chronological replay, sort by `(reported_at, id)`; file order groups examples
by expected cluster. Fixed historical dates work for offline evaluation. A live
fixture replay must shift all timestamps by the same offset to preserve intervals.
Preetham owns that database replay script; this file is the labeled ML fixture.

## Known limitations

- The 30-report seed set is development data; fitting it is not validation on
  unseen reports. Check new paraphrases before claiming general accuracy.
- The in-browser model is the quantised ONNX export of the same MiniLM, so its
  cosine similarities can differ slightly from the Python model. The 0.32
  threshold has not been re-calibrated against the browser model yet.
