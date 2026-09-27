"""Setup decisions shared by the API and the next implementation phase."""

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
CLUSTER_WINDOW_SECONDS = 2 * 60 * 60
# Calibrated by `python -m ml_service.evaluate_seed` using the labelled pair
# checks in data/reports.json. A candidate must also share category, location,
# and the two-hour incident window before its embedding is compared.
CLUSTER_SIMILARITY_THRESHOLD = 0.32
