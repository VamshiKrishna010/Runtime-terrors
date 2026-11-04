"""In-memory sliding-window limits protecting the paid Groq endpoint.

Two limits apply: per client (default 6/minute) and a global hourly budget
(default 120/hour) that caps spend even if many clients share an address or
spoof headers. This is per process; run one worker or put a shared limiter
(e.g. Cloudflare rate limiting) in front for multi-instance deployments.
"""
import os
import threading
import time
from collections import defaultdict, deque


class SlidingWindow:
    def __init__(self, limit: int, seconds: float):
        self.limit, self.seconds = limit, seconds
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def retry_after(self, key: str, now: float) -> float:
        hits = self.hits[key]
        while hits and now - hits[0] >= self.seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            return self.seconds - (now - hits[0])
        return 0.0


class AnalyzeLimiter:
    def __init__(self, per_client_per_minute=None, global_per_hour=None, clock=time.monotonic):
        self.client = SlidingWindow(int(per_client_per_minute or os.getenv("ANALYZE_RATE_PER_MINUTE", "6")), 60)
        self.global_ = SlidingWindow(int(global_per_hour or os.getenv("ANALYZE_GLOBAL_PER_HOUR", "120")), 3600)
        self.clock = clock

    def check(self, client_key: str) -> float:
        """Record a hit and return 0, or return seconds to wait without recording."""
        now = self.clock()
        with self.client.lock:
            wait = max(self.client.retry_after(client_key, now), self.global_.retry_after("*", now))
            if wait > 0:
                return wait
            self.client.hits[client_key].append(now)
            self.global_.hits["*"].append(now)
            return 0.0


def client_key(request) -> str:
    # Only trust proxy headers when a proxy we control sets them (Docker/tunnel).
    if os.getenv("TRUST_PROXY_HEADERS") == "1":
        forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"
