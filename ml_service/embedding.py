"""Lazy, normalized MiniLM embeddings used by clustering."""

from functools import lru_cache

from .config import MODEL_ID


@lru_cache(maxsize=1)
def get_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_ID)


def model_loaded() -> bool:
    return get_model.cache_info().currsize > 0


def embed_texts(texts: list[str]) -> list[list[float]]:
    vectors = get_model().encode(
        texts,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return [[float(value) for value in vector] for vector in vectors]
