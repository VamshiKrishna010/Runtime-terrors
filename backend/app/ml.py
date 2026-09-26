import re
from typing import Iterable


STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were",
    "in", "on", "at", "to", "of", "and", "or",
    "my", "our", "this", "that", "it"
}


def tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())

    return {
        word
        for word in words
        if word not in STOP_WORDS
    }


def similarity(a: str, b: str) -> float:
    a_tokens = tokenize(a)
    b_tokens = tokenize(b)

    if not a_tokens or not b_tokens:
        return 0.0

    intersection = a_tokens & b_tokens
    union = a_tokens | b_tokens

    return len(intersection) / len(union)


def best_similarity(
    text: str,
    others: Iterable[str]
) -> float:

    others = list(others)

    if not others:
        return 0.0

    scores = [
        similarity(text, other)
        for other in others
    ]

    return max(scores)