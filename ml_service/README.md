# VeriPulse ML setup

Owner: Vamshi. Deliverables for the 3:30-4:30 PM setup block: model choice,
30 labeled synthetic reports, and a runnable FastAPI service skeleton.

## Status

- Selected model: `sentence-transformers/all-MiniLM-L6-v2`.
- Dataset: `data/reports.json`, 30 reports across 10 expected incidents, with 12 explicit pair checks.
- Working routes: `GET /health`, `/docs`, `/openapi.json`.
- Planned routes: `POST /embed` and `POST /score` validate requests, then return HTTP 501.
- No model download, inference, calibrated threshold, or new scoring implementation yet.
  `ok: true` on `/health` means the process is alive; capabilities remain false.

This service is separate from the existing FastAPI/SQLite app in `backend/`.
The build plan calls for Convex actions to call this service over HTTP. Its
default development port is 8001 to avoid the existing backend on 8000.

## Model decision

Use the model already selected in the team build plan. Its
[official model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
documents 384-dimensional sentence embeddings suitable for clustering, an
Apache-2.0 license, and default truncation after 256 word pieces.

Implementation target for the core block: load one SentenceTransformer instance
per process on CPU and call `encode(texts, normalize_embeddings=True)`. Keep
output order identical to input order. Sentence-transformers and model weights
will be installed in that block; they are deliberately not runtime dependencies
of this setup skeleton. The 2,000-character request limit is an API bound, not a
guarantee that the model will encode every token.

Cosine similarity compares descriptions. Canonical building and time are separate
eligibility checks owned by the clustering integration. Do not merge two incidents
solely because their descriptions are similar. Use a two-hour candidate window;
the exact incident timestamp anchor should be agreed with Jas before integration.
`CLUSTER_SIMILARITY_THRESHOLD` remains `None` until evaluated on the seed data.
Do not reuse the old backend's 0.20 word-overlap threshold for cosine similarity.

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

The validator checks fixture consistency; it does not measure ML accuracy. This
setup requires no keys or model downloads. Tests do not modify the app database.

## Proposed API contracts for Jas

These are proposed handoff contracts, not a claim of team agreement. OpenAPI is
generated from `schemas.py`; unknown request fields are rejected with HTTP 422.
Convex makes server-to-server requests, so browser CORS is not required here.

### POST /embed

Request: 1-64 nonblank descriptions, at most 2,000 characters each.

```json
{"texts": ["Wi-Fi keeps dropping in ITE.", "Eduroam disconnects upstairs."]}
```

Future success response fields:

| Field | Meaning |
| --- | --- |
| `model` | `sentence-transformers/all-MiniLM-L6-v2` |
| `dimensions` | `384` |
| `normalized` | `true` |
| `embeddings` | One L2-normalized array of 384 floats per input, in input order |

Current response is HTTP 501 with `detail.code = "not_implemented"` and
`detail.capability = "embed"`. No placeholder vectors are returned.

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
  "location_consistency": 1.0,
  "time_proximity": null,
  "visual_match": "unavailable"
}
```

Counts must be nonnegative integers. Agreement and optional consistency values
must be within [0, 1]. For a single report, use agreement 0; when aggregating
cosine similarities, clamp negative values to 0. An eventual scoring
implementation must not treat missing metadata or an unavailable visual check
as negative evidence. `metadata_conflicts` counts known mismatches only.
The caller must deduplicate reporter and vote identities before constructing
counts; this stateless service cannot verify independence from these aggregates.

Future success response: `support_score` (0-100), `evidence_level`
(`Low`, `Emerging`, or `Strong`), and `reasons` (human-readable contribution
strings). The score measures support, not probability of truth.

Current response is HTTP 501 with `detail.capability = "score"`. Weights and
label thresholds are deferred to the integration block. The existing backend
scorer remains separate and is not exposed as the new scoring contract.

### Photo analysis boundary

Jas owns EXIF, pHash, and the vision call. The build plan places
`POST /analyze-photo` at the ML service boundary, but its upload/storage contract
still needs coordination with Jas. This setup does not implement that route or
invent a Convex storage format. Vamshi's scorer will accept the resulting
aggregate evidence signals through `/score`.

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
demo seeder must shift all timestamps by the same offset to preserve intervals.
Preetham owns that database replay script; this file is the labeled ML fixture.

## Next block

1. Implement MiniLM loading and `/embed`; verify vector shape, ordering, and normalization.
2. Evaluate candidate cosine thresholds on all labeled pairs after location/time
   filtering. Report precision, recall, false merges, and false splits, including
   the 12 named pair checks. Replay reports chronologically as an integration check.
3. Treat this small seed set as development data. Check new paraphrases separately
   before claiming general accuracy; fitting these 30 examples is not validation
   on unseen reports.
4. Hand Jas the proposed JSON contracts and 384-dimensional vector index requirement.
5. Implement `/score` with reason strings during the integration block.
