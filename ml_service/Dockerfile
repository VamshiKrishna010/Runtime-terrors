FROM python:3.12.8-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/app/.cache/huggingface

COPY requirements-runtime-lock.txt ./ml_service/requirements-runtime-lock.txt
RUN pip install --no-cache-dir --only-binary :all: --require-hashes \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r ml_service/requirements-runtime-lock.txt

COPY __init__.py config.py embedding.py evaluate_seed.py main.py schemas.py \
    scoring.py validate_seed.py ./ml_service/
COPY data/reports.json ./ml_service/data/reports.json
RUN useradd --create-home --uid 10001 app && mkdir -p /app/.cache && chown -R app /app/.cache
USER app
# Download MiniLM at build time so the first report does not wait for it.
RUN python -c "from sentence_transformers import SentenceTransformer; \
SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

EXPOSE 8001
CMD ["uvicorn", "ml_service.main:app", "--host", "0.0.0.0", "--port", "8001"]
