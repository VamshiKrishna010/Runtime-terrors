"""Setup decisions shared by the API and the next implementation phase."""

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
CLUSTER_WINDOW_SECONDS = 2 * 60 * 60
# Set only after evaluating embeddings against data/reports.json.
CLUSTER_SIMILARITY_THRESHOLD: float | None = None
