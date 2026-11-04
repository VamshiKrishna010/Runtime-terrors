FROM python:3.12.8-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/app/.cache/huggingface

COPY requirements.txt ./ml_service/requirements.txt
# CPU-only torch keeps the image small; sentence-transformers then resolves to it.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.9.1 \
 && pip install --no-cache-dir -r ml_service/requirements.txt

COPY . ./ml_service
RUN useradd --create-home --uid 10001 app && mkdir -p /app/.cache && chown -R app /app/.cache
USER app
# Download MiniLM at build time so the first report does not wait for it.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

EXPOSE 8001
CMD ["uvicorn", "ml_service.main:app", "--host", "0.0.0.0", "--port", "8001"]
