# VeriPulse vision-analysis service

A small, **stateless and optional** FastAPI service. It holds the Groq API key
and turns one uploaded photo plus the report text into a validated vision
result. It stores nothing.

Convex (`frontend/convex/`) is the single source of truth for reports,
incidents, votes, evidence review, scoring and analytics. The old SQLite
backend (its `/reports`, `/incidents`, `/evidence`, `/analytics` routes and
word-overlap clustering) was retired because the live app never wrote to it,
so Evidence Center and Analytics showed different data from Live Incidents.

## API

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ok, vision_configured}` |
| `POST /evidence/analyze` | multipart `image` (JPEG/PNG/WebP, ≤10 MB, ≤25 MP) and `description` |

`/evidence/analyze` always answers 200 with a `status`:

```json
{"status": "ok",
 "summary": "Water pooling near a doorway.",
 "authenticity": {"classification": "likely_real", "confidence": 0.82, "reason": "..."},
 "visualComparison": {"match": "partial", "confidence": 0.6, "reason": "..."},
 "detail": null}
```

- **One model call per photo.** Description, authenticity and claim comparison
  share a single Groq request (previously three requests across two keys).
- **Validated output.** Each part is checked separately: classification and
  match must be known values, confidences are coerced to numbers and clamped
  to [0, 1], and text is length-limited. A malformed part becomes `null`.
- **Graceful degradation.** A missing `GROQ_API_KEY`, network error or quota
  error returns `{"status": "unavailable"}` instead of a 500, and the browser
  submits the report without vision data.
- **Spend protection.** Per-client limit (`ANALYZE_RATE_PER_MINUTE`, default 6)
  plus a global hourly budget (`ANALYZE_GLOBAL_PER_HOUR`, default 120) → 429
  with `Retry-After`. Set `TRUST_PROXY_HEADERS=1` only behind a proxy you
  control (Docker Compose does this) so limits use the real client IP. The
  limiter is in memory, so run one worker per instance.
- Rejected uploads (bad type, too large) never reach Groq. Photos are held in
  memory only.

Only `visualComparison.match` affects the score (yes +8, partial +4, no −4).
Authenticity is shown to reviewers in Evidence Center but is not scored: a
visual guess about AI generation is not reliable enough to penalise reporters.

## Run

```bash
cd backend
cp .env.example .env   # set GROQ_API_KEY
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m unittest discover -s tests -v
```

The Vite dev server proxies `/api` here. In production builds, set
`VITE_API_URL` to this service's public URL, or leave it unset on GitHub Pages
to skip vision analysis.

## Limits

There is no authentication: anyone who can reach the URL can spend the hourly
budget, but not more than it. For a public deployment, also put a Cloudflare
rate-limiting rule in front of the tunnel.
