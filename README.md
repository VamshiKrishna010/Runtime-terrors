# VeriPulse

HackUMBC AI/ML MVP for support-scored crowdsourced campus incident reports.

## Architecture

| Part | Role | Needed for |
| --- | --- | --- |
| `frontend/convex/` | **Single source of truth.** Reports, incidents, votes, evidence review, clustering, scoring, analytics | Everything |
| `frontend/` | React + Vite UI, MiniLM embedding in the browser, EXIF/pHash measurement | Everything |
| `backend/` | Stateless Groq vision analysis (one call per photo) | Optional: vision signals |
| `ml_service/` | MiniLM `/embed` and an offline mirror of the scorer | Optional: server-side embeddings, evaluation |

What happens when someone submits a report:

1. The browser embeds the description with `all-MiniLM-L6-v2`, either in the
   browser (transformers.js, the default) or via `ml_service` when
   `VITE_ML_SERVICE_URL` is set.
2. If a photo is attached, the browser reads its capture time, camera and GPS
   with exifr and computes a 64-bit pHash (same construction as Python
   `imagehash.phash`). It asks `backend/` for vision analysis; if that service
   is offline, unconfigured or rate-limited, the report still submits.
3. The photo is uploaded to Convex Storage, and `reports:submit` (a Convex
   action) **strips EXIF/XMP/IPTC/text metadata from the stored bytes**,
   deletes the original, and hashes the clean file with SHA-256.
4. An internal mutation validates everything, clusters the report (same
   category and location, two-hour window, cosine ≥ 0.32, indexed by time),
   flags reused images (same SHA-256 or pHash Hamming distance ≤ 6), computes
   capture-time/GPS consistency, and **rescores the incident server-side**.
5. Votes go through `incidents:vote`, which keeps one vote per device per
   incident and rescores immediately.

No client can write a score: there is no public mutation that sets one.

### Privacy

- Reporter and voter identity is a random per-browser token
  (`src/deviceToken.js`), not a shared default. It is never returned by a
  public query.
- Public queries (`reports:byIncident`, `evidence:list`, `analytics:summary`)
  never return reporter tokens, embeddings or GPS.
- Raw EXIF GPS is never stored. Convex keeps only whether GPS existed and its
  distance from the reported pin.
- Images stored before this change kept their EXIF, so they are withheld from
  every query. Clean them up once per deployment (below).

### Scoring

`frontend/convex/lib/scoring.ts` is the canonical scorer. `ml_service/scoring.py`
mirrors it, and both are tested against `shared/scoring_cases.json`. The
weights are documented in [ml_service/README.md](ml_service/README.md#post-score).
The score summarises supporting signals; it is not a probability of truth.

## Run locally

Create the repository-root `.env` from `.env.example` and set `CONVEX_URL`.
For vision analysis, also create `backend/.env` from `backend/.env.example`
with a `GROQ_API_KEY`.

### Tilt (all services)

Install [Tilt](https://docs.tilt.dev/install.html), Node.js 22 and Python 3.12+.

```sh
tilt up
```

| Service | Address |
| --- | --- |
| Frontend | http://localhost:5173 |
| Vision analysis docs | http://localhost:8000/docs |
| ML service docs | http://localhost:8001/docs |
| Tilt dashboard | http://localhost:10350 |

Run one service with `tilt up -f frontend/Tiltfile` (or the `backend`/`ml_service`
Tiltfile). The frontend alone is enough to submit reports; vision results then
show as unavailable.

### Manual

```sh
cd frontend && npm ci && npm run dev
```

The backend and ML service are optional; see their READMEs.

### Docker Compose

```sh
cp .env.example .env             # set CONVEX_URL
cp backend/.env.example backend/.env   # set GROQ_API_KEY
docker compose up --build
```

This builds the frontend for production and serves it with nginx at
http://localhost:5173. nginx proxies `/api` to the vision service and `/ml` to
the ML service; all three are in `docker-compose.yml`. A Cloudflare Quick Tunnel
publishes the frontend: run `docker compose logs tunnel` for the
`trycloudflare.com` URL. Tunnel URLs change whenever the container is recreated.

## Checks

```sh
cd frontend && npm run typecheck && npm test && npm run build
cd backend && python -m unittest discover -s tests -v
python -m ml_service.validate_seed && python -m unittest discover -s ml_service/tests -v
```

`.github/workflows/ci.yml` runs these once per PR and per push to `pre-dev`,
`dev` and `main` (no duplicate workflows), then deploys.

## Convex delivery and GitHub Pages

Never commit deploy keys. Create two GitHub **Environments** under
`Settings → Environments`, each with a secret named `CONVEX_DEPLOY_KEY`:

| GitHub environment | Convex deploy key target | Used when |
| --- | --- | --- |
| `convex-deployment` | The shared development deployment | A push to `pre-dev` or `dev` |
| `convex-production` | The production deployment | A merged PR from `pre-dev` or `dev` into `main` |

Create each key in the Convex deployment's **Settings → Deploy keys** with the
`deployment:deploy` permission.

The production job also publishes the frontend to
`https://vamshikrishna010.github.io/Runtime-terrors/` (choose **GitHub Actions**
under `Settings → Pages`). The Pages build needs no server: embeddings run in
the browser and vision analysis is skipped unless the `VITE_API_URL` repository
variable points at a hosted `backend/`.

### One-time data migration (each deployment)

After deploying these functions, scrub legacy privacy data and recompute every
score with the server-side scorer:

```sh
cd frontend
npx convex run migrations:scrubLegacyPrivacy '{"deleteUnsanitizedImages": true}'
npx convex run migrations:rescoreAll
```

Add `--prod` for the production deployment. Both are internal functions and
cannot be called from a browser.

## Known limitations

- There is no real authentication. Device tokens stop accidental double
  counting, but someone who clears storage or uses several browsers counts as
  several reporters or voters. Per-token rate limits (5 reports per 10 minutes,
  20 votes per minute) slow abuse; they do not prevent it.
- Image measurements (pHash, EXIF time, camera) come from the browser. A
  modified client could lie about them. Metadata stripping, SHA-256, clustering
  and scoring happen on the server.
- `evidence:review` is public, like the review endpoint it replaced.
- Duplicate detection scans every stored pHash (an indexed range that skips
  reports without images). Clustering reads only the last two hours of reports.
