"""One gate for every OpenAI request the AI service makes (see llm_service.client).

The account allows about 450,000 tokens a minute and an essay uses about
95,000, so two busy marking runs at once can exhaust it; when that happened
the retries ran out and whole essays failed. The gate does two things:

1. Caps requests in flight at OPENAI_MAX_IN_FLIGHT (default: the specialist
   pool size, OPENAI_MAX_PARALLEL, 18) across every marking run in this
   process -- holistic, specialist, aggregation and final-marking calls alike.
2. Paces from OpenAI's own counters. Every response says how many tokens and
   requests the account has left and when they reset (x-ratelimit-* headers).
   They are account-wide, so every process -- other replicas, scripts -- sees
   the same numbers: once either falls below OPENAI_PACING_LOW_SHARE of the
   limit (default 10%), new requests wait for the reset instead of being sent
   into a 429. A 429 that still happens is retried by the OpenAI client.
"""

import os
import re
import threading
import time

import httpx

_MAX_IN_FLIGHT = int(os.getenv("OPENAI_MAX_IN_FLIGHT", os.getenv("OPENAI_MAX_PARALLEL", "18")))
_LOW_SHARE = float(os.getenv("OPENAI_PACING_LOW_SHARE", "0.1"))
_MAX_WAIT_SECONDS = 20.0  # re-checked after each wait; the next response updates the counters

_DURATION_PART = re.compile(r"(\d+(?:\.\d+)?)(ms|h|m|s)")
_UNIT_SECONDS = {"h": 3600.0, "m": 60.0, "s": 1.0, "ms": 0.001}


def parse_reset(value) -> float | None:
    """OpenAI's reset durations ("6m0s", "1.5s", "12ms") in seconds."""
    if not isinstance(value, str) or not value:
        return None
    parts = _DURATION_PART.findall(value)
    if not parts or "".join(n + u for n, u in parts) != value.strip():
        return None
    return sum(float(number) * _UNIT_SECONDS[unit] for number, unit in parts)


class RateBudget:
    """The account's remaining budget as last reported by OpenAI."""

    def __init__(self, low_share: float = _LOW_SHARE):
        self._low_share = low_share
        self._lock = threading.Lock()
        self._resume_at = 0.0

    def note(self, headers, now: float) -> None:
        for kind in ("tokens", "requests"):
            try:
                limit = float(headers[f"x-ratelimit-limit-{kind}"])
                remaining = float(headers[f"x-ratelimit-remaining-{kind}"])
            except (KeyError, TypeError, ValueError):
                continue
            reset = parse_reset(headers.get(f"x-ratelimit-reset-{kind}"))
            if reset is not None and limit > 0 and remaining < limit * self._low_share:
                with self._lock:
                    self._resume_at = max(self._resume_at, now + reset)

    def wait_seconds(self, now: float) -> float:
        with self._lock:
            return max(0.0, min(self._resume_at - now, _MAX_WAIT_SECONDS))


class GatedTransport(httpx.BaseTransport):
    """Wraps the real transport: waits while the account is nearly out of
    budget, then holds one of the in-flight slots for the request."""

    def __init__(self, inner: httpx.BaseTransport, max_in_flight: int = _MAX_IN_FLIGHT,
                 budget: RateBudget | None = None, clock=time.monotonic, sleep=time.sleep):
        self._inner = inner
        self._slots = threading.BoundedSemaphore(max_in_flight)
        self.budget = budget or RateBudget()
        self._clock = clock
        self._sleep = sleep

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        while (wait := self.budget.wait_seconds(self._clock())) > 0:
            print(f"[OPENAI GATE] account nearly at its rate limit -- waiting {wait:.1f}s", flush=True)
            self._sleep(wait)
        with self._slots:
            response = self._inner.handle_request(request)
        self.budget.note(response.headers, self._clock())
        return response

    def close(self) -> None:
        self._inner.close()
