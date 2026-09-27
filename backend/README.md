# VeriPulse local backend and end-to-end demo

The FastAPI/SQLite backend is the source of truth for reports, incidents, uploads,
evidence analysis, votes and review state. Convex is no longer a prerequisite for
report uploads. The existing Convex helper remains available but is not called by
this local workflow. No new runtime dependencies were required.

## Run (PowerShell, from the repository root)

Backend terminal:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend terminal:

```powershell
cd frontend
npm install
npm run dev -- --host localhost --port 5173
```

Open http://localhost:5173. API documentation is http://127.0.0.1:8000/docs.
The frontend defaults to that API origin; set `VITE_API_URL` before starting Vite
to use another origin. Both localhost:5173 and 127.0.0.1:5173 are allowed by CORS.

## Frontend/API mapping

| UI | Existing/new API | Behavior |
| --- | --- | --- |
| Dashboard, map, Live Incidents | GET /incidents | Accurate report counts, coordinates, calculated support and reasons |
| Selected incident | GET /incidents/{id} | Same incident fields plus reports and evidence URLs |
| Report form | POST /reports | Multipart reporter_token, description, category, location, optional image, latitude and longitude |
| Confirm/contradict | POST /incidents/{id}/confirm or /contradict | Optional JSON reporter_token; updated complete incident |
| Evidence Center | GET /evidence | Real stored attachments and measured analysis; no demo fallback |
| Evidence detail | GET /evidence/{id} | Detailed analysis and persisted timeline |
| Evidence counts | GET /evidence/summary | Real totals, unique images, reused attachments and conflicts |
| Review controls | PATCH /evidence/{id}/review | JSON review_state: unreviewed, reviewed or flagged |
| Future Analytics UI | GET /analytics/summary | Counts by category/location/level, votes, UTC daily report volume and evidence counts |

GET /evidence supports `search`, `status`, `incident_id`, `type` and `sort`.
Sort values: newest, highest_support, needs_review, duplicate_first.
The current Evidence Center filters the returned collection locally to retain its
existing search/sort behavior. Its summary cards count the whole collection.

## Storage and migration

- Existing `incident` and `report` tables remain. `Report.image_path` is retained.
- Additive `incident.updated_at` column; backfilled from created_at.
- New `evidence` table: report/incident references, media type, original name,
  generated filename, size, upload time, SHA-256, pHash, measured metadata JSON,
  known source, review state and timeline JSON.
- New `vote` table: one current action per incident and reporter token.
- Startup uses SQLite's backup API before the first structural update of an
  existing database. Backups are `*.migration-<timestamp>.bak` and are ignored.
- Startup indexes actual legacy report attachments only if the file exists and
  can be analyzed. It does not invent missing reports or evidence. Existing
  orphan incidents remain visible with an accurate count of zero.
- Uploads live in `backend/uploads/`, independent of the process working directory.
  Names use UUIDs plus a validated extension. URLs are `/uploads/<uuid>.<ext>`,
  resolved by the frontend to `http://127.0.0.1:8000/uploads/<uuid>.<ext>`.
- Database files, migration backups, node_modules, .venv and uploads are ignored.
  Existing tracked generated files are not automatically untracked by .gitignore.
- Optional isolation settings: `VERIPULSE_DATABASE_URL` and `VERIPULSE_UPLOADS_DIR`.

Report + incident + evidence writes are one SQLite transaction. Failed validation
cannot leave a new empty incident. A failed database/file operation rolls back
records and removes the newly written file. Existing orphan incidents are not deleted.

## Clustering and score

The backend reuses `app/ml.py`'s deterministic token-set Jaccard similarity.
Candidates must share normalized location and category and have a report within
2 hours. Similarity >= 0.20 joins the best candidate; otherwise a new incident is
created. This is lexical overlap, not learned semantic embedding or visual AI.

Existing support weights are preserved:

- Distinct pseudonymous reporter tokens: +12 each, cap +36.
- Average calculated description overlap: up to +22; zero when no comparison exists.
- Confirmations: +5 each, cap +20.
- Reported text location agreement: up to +10 (not GPS verification).
- Unique supporting images: +4 each, cap +12.
- Reused evidence: -12 each, cap -36.
- Contradictions: -7 each, cap -28.

Total is clamped to 0-100; Low below 35, Emerging below 70, Strong otherwise.
Reasons state the measured inputs and do not claim truth or identity verification.
Evidence cards show their allocated image term in points, not the old mock /25
score. Allocation follows evidence ID order for incident caps.

Votes with a token are idempotent. Switching from confirm to contradict reverses
the previous action. Legacy requests without a body still increment counters;
these cannot be deduplicated. The UI sends the report form's pseudonymous token.
This is not authentication; tokens can be changed or shared.

## Evidence measurements and limits

- Maximum upload: 10 MB; decoded images: at most 25 megapixels.
- Pillow verifies and decodes JPEG/PNG/WebP/GIF, reads dimensions, format, EXIF
  device/software/time and GPS when available. Absent fields remain null/missing.
- MP4/WebM uploads have basic container signature validation only. There is no
  video transcoding, playback/codec validation, EXIF extraction or visual inference.
  Evidence Center supports video playback; Live Incidents displays image evidence.
- SHA-256 detects identical bytes. ImageHash pHash uses Hamming distance <= 6 for
  near-duplicate candidates. Distances and matching counts are computed from stored
  hashes. Similarity is a review signal; unrelated simple images can share a pHash.
- Time comparison requires a capture timezone. Missing timezone -> needs_review
  with no fabricated time difference. Between 5 minutes in the future and 1 hour
  old -> consistent; over 24 hours old or over 1 hour in the future -> conflicting;
  middle range -> needs_review. Missing capture time -> unavailable.
- Location uses haversine distance only when both reported coordinates and EXIF
  GPS exist: <=150 m consistent, <=1000 m needs_review, farther conflicting.
  Typed building locations are not converted into stored GPS. The map may display
  its existing building-center fallback when an incident has no coordinates.
- Source is gallery_upload for form uploads. No in-app capture chain is asserted.
  Legacy indexed attachments have unknown source. Raw IPs are not stored.
- Image-to-report comparison remains unavailable (null summary/score). The separate
  ml_service is still a skeleton with /embed and /score returning 501; no model
  inference is fabricated or required to submit reports.
- Timeline records upload, inspection/hash/scan/link events and review changes.
  It never claims an AI visual comparison ran.

This is a local MVP: public evidence/review APIs have no authentication, duplicate
comparison is quadratic in evidence count, and no background processing is used.
The existing Analytics page remains a placeholder; its backend is ready. Header
notification mocks remain unchanged. Production deployment needs authentication,
access control, stricter media processing and operational limits.

## Development cleanup (off by default)

For a disposable development database only, start the backend with
`$env:VERIPULSE_ENABLE_DEV_CLEANUP="1"`. Then DELETE /dev/incidents removes all
incident-related rows, or DELETE /incidents/{id} removes one incident. Responses
include removed row/vote/file counts. Files are removed only after no remaining
report/evidence references them and only within the configured uploads directory.
With `VERIPULSE_ENV=production`, both routes remain disabled regardless of the flag.
No cleanup is run against your normal database by the automated test workflow.

## Verify the demo

1. Start both servers above; open Dashboard at http://localhost:5173.
2. Enter a reporter token and description; choose Network / IT, Facilities,
   Environmental, Safety or Other, and enter a location.
3. Optionally click **Pin report location on campus map**, then click the existing
   map above. Coordinates can also be entered with keyboard-accessible inputs.
4. Attach a JPEG/PNG/WebP/GIF image; submit. The success message identifies the
   incident. On failure the form retains its data and shows the API error.
5. Open Live Incidents, select it, and verify the report count and image. Click the
   image for a larger preview. GET /incidents/{id} also exposes its /uploads URL.
6. Confirm it; inspect the count/score/reasons. Repeat with the same token to see
   deduplication; contradict to switch that token's vote.
7. Open Evidence Center. Select the real attachment and inspect metadata, hashes,
   duplicate, time and location signals. Missing EXIF is reported as unavailable.
8. Mark reviewed or flagged. Reload the browser and reopen Evidence Center to
   verify persistence. Re-upload the same file under another token to test reuse.
9. Verify a supplied coordinate pin on the campus map. Inspect
   http://127.0.0.1:8000/analytics/summary for real aggregate values.

## Automated checks (from repository root)

```powershell
cd backend
python -m unittest discover -s tests -v
cd ..
python -m unittest discover -s ml_service/tests -v
python backend/tests/verify_http.py
cd frontend
npm run build
```

`verify_http.py` launches real Uvicorn and Vite, preferring ports 8000 and 5173,
uses temporary SQLite/uploads, exercises report/file/vote/evidence/review/analytics
HTTP flows, verifies persisted rows, renders real API records through the frontend
components, then shuts down both servers. It does not control a browser. Browser
clicks, map interaction, responsive appearance and native media playback still
need the manual verification above if no browser automation session is available.
