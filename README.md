# VeriPulse

HackUMBC AI/ML MVP for trust-scored crowdsourced incident reports.

## Structure

- `frontend/` - React + Vite application
- `backend/` - FastAPI + SQLite API

## Run the backend

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
