"""Per-essay cost tracking.

Every OpenAI response passing through the shared client is counted
automatically (see llm_service's http client hook), tagged with the marking
stage that was running, so the cost of one essay can be logged and returned
without each LLM call having to report its own usage.

Prices are OpenAI list prices in US dollars per million tokens. Models not
listed are counted but priced as unknown rather than guessed. Datalab (the
handwriting OCR) is priced only if DATALAB_COST_PER_PAGE_USD is set.
"""

import contextvars
import os

_PRICES_PER_MILLION = {
    # model prefix: (input, cached input, output)
    "gpt-4o-mini": (0.15, 0.075, 0.60),
    "gpt-4o": (2.50, 1.25, 10.00),
    "text-embedding-3-small": (0.02, 0.02, 0.0),
}

_current = contextvars.ContextVar("essay_cost", default=None)
_stage = contextvars.ContextVar("cost_stage", default="other")


def start() -> None:
    """Begin counting for one essay (call at the start of a marking request)."""
    _current.set({"openai": [], "datalab_pages": 0, "datalab_calls": 0})
    _stage.set("other")


def set_stage(name: str) -> None:
    """Calls from now on count towards this marking stage."""
    _stage.set(name)


def _price(model: str):
    for prefix in sorted(_PRICES_PER_MILLION, key=len, reverse=True):
        if model.startswith(prefix):
            return _PRICES_PER_MILLION[prefix]
    return None


def record_openai(model: str, prompt_tokens: int, cached_tokens: int, completion_tokens: int) -> None:
    current = _current.get()
    if current is None:
        return
    current["openai"].append({
        "stage": _stage.get(), "model": model or "unknown",
        "prompt_tokens": prompt_tokens or 0, "cached_tokens": cached_tokens or 0,
        "completion_tokens": completion_tokens or 0,
    })


def record_datalab(pages: int) -> None:
    current = _current.get()
    if current is None:
        return
    current["datalab_calls"] += 1
    current["datalab_pages"] += pages


def summary() -> dict | None:
    """Cost of the essay counted since start(), by stage, in US dollars."""
    current = _current.get()
    if current is None:
        return None
    by_stage, unpriced = {}, set()
    for call in current["openai"]:
        price = _price(call["model"])
        if price is None:
            unpriced.add(call["model"])
            cost = 0.0
        else:
            uncached = call["prompt_tokens"] - call["cached_tokens"]
            cost = (uncached * price[0] + call["cached_tokens"] * price[1] + call["completion_tokens"] * price[2]) / 1_000_000
        entry = by_stage.setdefault(call["stage"], {"calls": 0, "cost_usd": 0.0, "prompt_tokens": 0, "cached_tokens": 0, "completion_tokens": 0})
        entry["calls"] += 1
        entry["cost_usd"] += cost
        for key in ("prompt_tokens", "cached_tokens", "completion_tokens"):
            entry[key] += call[key]

    per_page = os.getenv("DATALAB_COST_PER_PAGE_USD")
    datalab_cost = float(per_page) * current["datalab_pages"] if per_page else None
    openai_cost = sum(entry["cost_usd"] for entry in by_stage.values())
    for entry in by_stage.values():
        entry["cost_usd"] = round(entry["cost_usd"], 4)
    return {
        "openai_usd": round(openai_cost, 4),
        "datalab_usd": round(datalab_cost, 4) if datalab_cost is not None else None,
        "datalab_pages": current["datalab_pages"],
        "total_usd": round(openai_cost + (datalab_cost or 0.0), 4),
        "total_is_complete": datalab_cost is not None and not unpriced,
        "unpriced_models": sorted(unpriced),
        "by_stage": by_stage,
    }


def log_line(result: dict | None) -> str:
    if not result:
        return "[COST] not tracked"
    stages = ", ".join(f"{name} ${v['cost_usd']:.4f} ({v['calls']} calls)" for name, v in result["by_stage"].items())
    datalab = f"${result['datalab_usd']:.4f}" if result["datalab_usd"] is not None else f"price not set ({result['datalab_pages']} page(s))"
    note = "" if result["total_is_complete"] else " [incomplete: some costs unknown]"
    return f"[COST] essay total ${result['total_usd']:.4f}{note} | OpenAI ${result['openai_usd']:.4f}: {stages} | OCR: {datalab}"
