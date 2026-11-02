"""Run a marking request's independent OpenAI calls at the same time.

Each essay makes one call per sample per thread (3 threads x 6 samples in
calibrated mode); made one after another they took about two minutes. None
depends on another, so they run in parallel.

All calls go through one shared pool, so OPENAI_MAX_PARALLEL caps how many
are in flight across every essay being marked at once -- the worker marks
several essays together. Rate-limit (429) responses are retried with
backoff by the OpenAI client itself (see llm_service.client).

Each call runs in a copy of the caller's context, so per-essay cost tracking
(observability/cost_tracker, a contextvar) still sees it.
"""

import contextvars
import os
from concurrent.futures import ThreadPoolExecutor

_MAX_PARALLEL = int(os.getenv("OPENAI_MAX_PARALLEL", "18"))
_calls = ThreadPoolExecutor(max_workers=_MAX_PARALLEL, thread_name_prefix="openai-call")


def run_calls(fns: list) -> list:
    """Run zero-argument functions that each make one OpenAI call, through
    the shared pool. Results come back in the order given; the first error
    is raised."""
    futures = [_calls.submit(contextvars.copy_context().run, fn) for fn in fns]
    return [future.result() for future in futures]


def run_each(fns: list) -> list:
    """Run zero-argument functions that themselves use run_calls (e.g. one
    per thread), each on its own short-lived thread. Not the shared pool:
    tasks waiting on the pool from inside the pool could deadlock it."""
    if not fns:
        return []
    with ThreadPoolExecutor(max_workers=len(fns), thread_name_prefix="specialist-thread") as pool:
        futures = [pool.submit(contextvars.copy_context().run, fn) for fn in fns]
        return [future.result() for future in futures]
