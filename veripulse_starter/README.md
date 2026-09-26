# VeriPulse Starter

HackUMBC AI/ML MVP for trust-scored crowdsourced incident reports.

## Architecture
- Frontend: React + Vite
- Backend: FastAPI + SQLite
- ML: sentence-transformers for semantic clustering
- Evidence: Pillow EXIF + imagehash pHash duplicate detection
- Scoring: interpretable evidence support score

## Run backend
```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Run frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Demo flow
1. Submit "Wi-Fi keeps dropping in ITE".
2. Submit "eduroam not working in ITE" as a different reporter.
3. Watch the incident cluster move from Low toward Emerging.
4. Reuse the same image on another report to trigger duplicate evidence penalty.
5. Confirm an incident from the dashboard and show the support score reasons.
