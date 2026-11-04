FROM python:3.12.8-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements-runtime-lock.txt .
RUN pip install --no-cache-dir --only-binary :all: --require-hashes \
    -r requirements-runtime-lock.txt

COPY app ./app
RUN useradd --create-home --uid 10001 app
USER app

EXPOSE 8000
# One worker: the Groq spend limiter is in-memory per process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
