"""Run real Uvicorn + Vite against isolated data; no user records are mutated."""
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def free_port(preferred):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]


def wait_ready(url, process):
    for _ in range(80):
        if process.poll() is not None:
            raise RuntimeError(f"Server exited: {url}")
        try:
            response = httpx.get(url, timeout=0.5, trust_env=False)
            if response.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.15)
    raise RuntimeError(f"Server did not start: {url}")


def main():
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        port, vite_port = free_port(8000), free_port(5173)
        base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "VERIPULSE_DATABASE_URL": f"sqlite:///{temp / 'http.db'}",
               "VERIPULSE_UPLOADS_DIR": str(temp / 'uploads'), "VERIPULSE_ENABLE_DEV_CLEANUP": "1",
               "VERIPULSE_ENV": "development", "PYTHONDONTWRITEBYTECODE": "1", "VITE_API_URL": base}
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        processes = []
        with (temp / "servers.log").open("w+") as logs:
            try:
                backend = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT / "backend", env=env, stdout=logs, stderr=logs, creationflags=flags)
                processes.append(backend)
                frontend = subprocess.Popen([shutil.which("node"), str(ROOT / "frontend/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", str(vite_port), "--strictPort"], cwd=ROOT / "frontend", env=env, stdout=logs, stderr=logs, creationflags=flags)
                processes.append(frontend)
                wait_ready(base + "/health", backend)
                wait_ready(f"http://127.0.0.1:{vite_port}", frontend)
                with httpx.Client(base_url=base, trust_env=False, timeout=15) as client:
                    image = io.BytesIO()
                    Image.new("RGB", (80, 60), "blue").save(image, "PNG")
                    fields = {"reporter_token": "http-demo", "description": "Library walkway water accumulation", "category": "Environmental", "location": "Library", "latitude": "39.2565", "longitude": "-76.7128"}
                    response = client.post("/reports", data=fields, files={"image": ("sample.png", image.getvalue(), "image/png")})
                    assert response.status_code == 201, response.text
                    incident = response.json()["incident"]
                    iid = incident["id"]
                    assert incident["report_count"] == 1
                    assert incident["latitude"] == 39.2565 and incident["longitude"] == -76.7128
                    detail = client.get(f"/incidents/{iid}").json()
                    url = detail["evidence"][0]["url"]
                    assert client.get(url).content == image.getvalue()
                    assert (temp / "uploads" / url.split("/")[-1]).is_file()
                    with closing(sqlite3.connect(temp / "http.db")) as db:
                        assert db.execute("SELECT count(*) FROM report WHERE incident_id=?", (iid,)).fetchone()[0] == 1
                    confirmed = client.post(f"/incidents/{iid}/confirm", json={"reporter_token": "one"}).json()
                    assert confirmed["confirmations"] == 1 and confirmed["support_score"] > incident["support_score"]
                    contradicted = client.post(f"/incidents/{iid}/contradict", json={"reporter_token": "two"}).json()
                    assert contradicted["contradictions"] == 1
                    item = client.get("/evidence").json()[0]
                    assert item["metadata"]["width"] == 80 and len(item["sha256_hash"]) == 64
                    assert item["duplicate_analysis"]["duplicate_count"] == 0
                    assert client.patch(f"/evidence/{item['id']}/review", json={"review_state": "reviewed"}).status_code == 200
                    assert client.get(f"/evidence/{item['id']}").json()["review_state"] == "reviewed"
                    fixture = temp / "evidence.json"
                    fixture.write_text(json.dumps(client.get("/evidence").json()), encoding="utf-8")
                    subprocess.run([shutil.which("node"), "tests/verify-evidence.mjs", str(fixture)], cwd=ROOT / "frontend", check=True, env={**env, "VITE_API_URL": "http://127.0.0.1:8000"})
                    analytics = client.get("/analytics/summary").json()
                    assert analytics["total_reports"] == 1 and analytics["total_evidence"] == 1
                    assert client.delete("/dev/incidents").json()["files_removed"] == 1
                print(f"PASS: Uvicorn ({port}), Vite ({vite_port}), multipart report, SQLite association, file URL, votes, score, evidence, metadata, review persistence, coordinates, analytics and isolated cleanup.")
            except Exception:
                logs.flush()
                logs.seek(0)
                print(logs.read())
                raise
            finally:
                for process in reversed(processes):
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    main()
