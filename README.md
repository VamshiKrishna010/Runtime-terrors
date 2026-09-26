# VeriPulse

HackUMBC AI/ML MVP for trust-scored crowdsourced incident reports.

## Structure

- `frontend/` - React + Vite application
- `backend/` - FastAPI + SQLite API
- `ml_service/` - Vamshi's standalone ML setup skeleton and 30-report labeled seed set; see [ML setup](ml_service/README.md) for model choice, API contracts, and run commands.

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
