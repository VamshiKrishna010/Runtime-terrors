# VeriPulse

HackUMBC AI/ML MVP for trust-scored crowdsourced incident reports.

## Structure

- `frontend/` - React + Vite application
- `backend/` - FastAPI + SQLite API

## Run the backend

For a single-command development stack, use Tilt below. Manual startup commands
are also available here.

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Convex delivery through GitHub

The frontend reads the public Convex URL from the repository-level `.env`:

```env
CONVEX_URL=https://your-development-deployment.convex.cloud
```

Never commit deploy keys. Create two GitHub **Environments** under
`Settings → Environments` and add a secret named `CONVEX_DEPLOY_KEY` to each:

| GitHub environment | Convex deploy key target | Used when |
| --- | --- | --- |
| `convex-deployment` | The shared Convex development deployment | A PR is merged into `pre-dev` or `dev` |
| `convex-production` | The production Convex deployment | A merged PR from `pre-dev` or `dev` reaches `main` |

Create each scoped key in the corresponding Convex deployment’s **Settings →
Deploy keys** page, with the `deployment:deploy` permission. The
`Convex delivery` workflow runs frontend and backend CI first, then invokes
`npx convex deploy` with that environment’s key. A direct push to `main` does
not deploy production; only a merged pull request whose source is `pre-dev` or
`dev` can do so.

The same production job publishes the Vite frontend to GitHub Pages at
`https://vamshikrishna010.github.io/Runtime-terrors/`. In repository
`Settings → Pages`, choose **GitHub Actions** as the build and deployment
source before the first production merge.

## Run with Tilt

Install [Tilt](https://docs.tilt.dev/install.html), Node.js with npm, and Python
3.12 or newer. Ensure `python` is on PATH on Windows, or `python3` on macOS/Linux.
These Tiltfiles use [local resources](https://docs.tilt.dev/local_resource.html)
to run the current Vite, FastAPI/SQLite, and ML services. Docker and Kubernetes
are not required for this setup.

From the repository root:

```sh
tilt up
```

Tilt installs frontend dependencies with `npm ci`, creates a `.venv` in each
Python service directory, installs its requirements, and starts all three
services. Dependency file changes rerun setup and restart the affected service.
Vite handles frontend source updates; Uvicorn reloads Python source changes.

| Service | Address |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API docs | http://localhost:8000/docs |
| ML service docs | http://localhost:8001/docs |
| Tilt dashboard | http://localhost:10350 |

The root `Tiltfile` loads `frontend/Tiltfile`, `backend/Tiltfile`, and
`ml_service/Tiltfile`. To work on one service, run one of these from the root:

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
The ML health check confirms the skeleton is running; embedding and scoring
capabilities are still pending, as documented in [ML setup](ml_service/README.md).

To check startup and exit once all services pass their health probes:

```sh
tilt ci --timeout 5m
```

## Run with Docker Compose

Docker Compose starts the VeriPulse frontend, backend, and a Cloudflare Quick Tunnel.

### 1. Configure environment variables

Create the environment files from the provided templates:

    cp backend/.env.example backend/.env
    cp frontend/.env.example frontend/.env

Set `GROQ_API_KEY` in `backend/.env` and set `CONVEX_URL` in `frontend/.env`.

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

