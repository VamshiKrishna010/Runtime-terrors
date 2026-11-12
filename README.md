# VeriPulse

HackUMBC 2026 AI/ML project by Team Runtime Terrors: a campus incident-reporting
app that clusters crowdsourced reports and shows how strongly each incident is
supported by independent evidence, with a readable reason for every signal.
It measures support; it never claims a report is true or fake.

## Tech stack in use

| Part | Technology | What it does |
| --- | --- | --- |
| Web app (`frontend/`) | React, Vite, Leaflet, Recharts, Lucide | Reporter flow, dashboard, campus map, Live Incidents, analytics |
| Realtime data (`frontend/convex/`) | Convex | Reports, incidents, photo storage, cosine clustering, votes |
| ML service (`ml_service/`) | FastAPI, sentence-transformers `all-MiniLM-L6-v2` | `POST /embed` (384-dim vectors), `POST /score` (support score + reasons) |
| Backend (`backend/`) | FastAPI, Pillow, ImageHash, SQLModel/SQLite | `POST /evidence/analyze` (EXIF, perceptual hash, vision), Evidence Center and analytics APIs |
| Vision model | Groq API, `qwen/qwen3.8-27b` | Describes report photos and flags visible signs of editing or generation |
| Ops | Docker Compose, Cloudflare Tunnel, Tilt, GitHub Actions | Local stack, public demo URL, CI, Convex and GitHub Pages deploys |

## How a report flows

1. The web app sends the description to the ML service `/embed` (MiniLM).
2. If a photo is attached, the backend `/evidence/analyze` reads EXIF with Pillow,
   computes a perceptual hash with ImageHash, and calls Qwen vision on Groq.
   The photo itself is uploaded to Convex storage.
3. Convex `reports.createClustered` joins the best existing incident with the same
   category and building, within 2 hours, at cosine similarity >= 0.32; otherwise
   it starts a new incident. A photo hash already seen is marked as reused.
4. The web app sends the cluster's inputs to the ML service `/score` and saves the
   score, evidence level (Low / Emerging / Strong) and reasons with
   `incidents.applyScore`. The dashboard updates live through Convex.

Scoring inputs used today: distinct reporter tokens, semantic agreement, time
proximity, same-building agreement, confirmations, contradictions, unique images
and reused images. The scorer also supports visual-match and metadata-conflict
terms, which are not yet fed by the app. Confirm/contradict votes update counts;
the score is recalculated on the next report for that incident.

## Run the services manually

Backend (port 8000):

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

ML service (port 8001, from the repository root; see [ML setup](ml_service/README.md)):

```bash
python -m venv ml_service/.venv
ml_service/.venv/Scripts/python.exe -m pip install -r ml_service/requirements.txt
ml_service/.venv/Scripts/python.exe -m uvicorn ml_service.main:app --reload --port 8001
```

Frontend (port 5173):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The frontend needs `CONVEX_URL` and, if the ML service
is not on `http://127.0.0.1:8001`, `VITE_ML_SERVICE_URL`.

## Convex delivery through GitHub

The frontend reads the public Convex URL from the repository-level `.env`:

```env
CONVEX_URL=https://your-development-deployment.convex.cloud
```

Never commit deploy keys. Create two GitHub **Environments** under
`Settings → Environments` and add a secret named `CONVEX_DEPLOY_KEY` to each:

| GitHub environment | Convex deploy key target | Used when |
| --- | --- | --- |
| `convex-deployment` | The shared Convex development deployment | A PR is merged into `pre-dev` |
| `convex-production` | The production Convex deployment | Any PR is merged into `dev` |

Create each scoped key in the corresponding Convex deployment’s **Settings →
Deploy keys** page, with the `deployment:deploy` permission. The
`Convex delivery` workflow runs frontend and backend CI first, then invokes
`npx convex deploy` with that environment’s key. Promote changes from `pre-dev`
to `dev` through a pull request. Any merged PR into `dev` deploys production
after CI passes. Direct pushes do not deploy production; `main` has no deployment role.

The same production job publishes the Vite frontend to GitHub Pages at
`https://vamshikrishna010.github.io/Runtime-terrors/`. In repository
`Settings → Pages`, choose **GitHub Actions** as the build and deployment
source before the first production merge.

## Run with Tilt

Install [Tilt](https://docs.tilt.dev/install.html), Node.js with npm, and Python
3.12 or newer. Ensure `python` is on PATH on Windows, or `python3` on macOS/Linux.
These Tiltfiles use [local resources](https://docs.tilt.dev/local_resource.html)
to run the Vite frontend and the FastAPI/SQLite backend. Start the ML service
separately (see above, or `tilt up -f ml_service/Tiltfile`). Docker and Kubernetes
are not required for this setup.

From the repository root:

```sh
tilt up
```

Tilt installs frontend dependencies with `npm ci`, creates a `.venv` in the
backend directory, installs its requirements, and starts both services. Dependency file changes rerun setup and restart the affected service.
Vite handles frontend source updates; Uvicorn reloads Python source changes.

| Service | Address |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API docs | http://localhost:8000/docs |
| ML service docs (started separately) | http://localhost:8001/docs |
| Tilt dashboard | http://localhost:10350 |

The root `Tiltfile` loads `frontend/Tiltfile` and `backend/Tiltfile`.
`ml_service/Tiltfile` runs on its own. To work on one service, run one of these
from the root:

```sh
tilt up -f frontend/Tiltfile
tilt up -f backend/Tiltfile
tilt up -f ml_service/Tiltfile
```

You can also run `tilt up` inside any service directory. Each child Tiltfile is
independent; the frontend alone still needs a running backend for API requests.
Use one root session for the full stack. If running child sessions concurrently,
give each Tilt dashboard a different port (for example `--port 10351`), and avoid
starting the same service twice. Stop manually started servers on ports 5173,
8000, and 8001 before starting Tilt. Vite uses a strict port so it cannot silently
move to an origin the backend does not allow.

Press Ctrl+C in the Tilt terminal to stop its local processes. Python virtual
environments, frontend dependencies, uploaded files, and SQLite data remain.

To check startup and exit once all services pass their health probes:

```sh
tilt ci --timeout 5m
```

## Run with Docker Compose

Docker Compose starts the VeriPulse frontend, backend, and a Cloudflare Quick Tunnel.
The ML service is not in the compose file; run it separately on port 8001.

### 1. Configure environment variables

Create the environment files from the provided templates:

    cp backend/.env.example backend/.env
    cp frontend/.env.example frontend/.env

Set `GROQ_API_KEY` and `GROQ_QWEN_API_KEY` in `backend/.env`, and set `CONVEX_URL`
(plus `VITE_ML_SERVICE_URL` if needed) in `frontend/.env`.

Do not commit `.env` files or API keys.

### 2. Start VeriPulse

From the repository root:

    docker compose up --build

The frontend is available at `http://localhost:5173`.

The backend API is available at `http://localhost:8000`.

The `tunnel` service automatically creates a temporary Cloudflare public URL. To find it, run:

    docker compose logs tunnel

Look for the `trycloudflare.com` URL in the output.

### 3. Stop VeriPulse

    docker compose down

Cloudflare Quick Tunnel URLs are temporary and may change whenever the tunnel container is recreated.

