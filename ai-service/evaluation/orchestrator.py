"""Shared repeated-run lifecycle for every evaluation target."""

from __future__ import annotations

from time import perf_counter
from typing import Any, Callable

from evaluation import database
from evaluation.runners import get_runner


ProgressCallback = Callable[[dict[str, Any]], None]


def run_evaluation(
    *,
    target_id: int,
    dataset_id: int,
    requested_runs: int = 10,
    name: str | None = None,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    if requested_runs < 1:
        raise ValueError("requested_runs must be at least 1")

    target = database.get_target(target_id)
    dataset = database.get_dataset(dataset_id)
    runner = get_runner(target["runner_key"])
    # A dataset is reusable across targets. The selected runner performs a
    # preflight check and then reads only the fields its prompt requires.
    runner["validate"](dataset)
    prompt_snapshot = runner["capture_prompt"](dataset)
    prompt_id = database.save_prompt_snapshot(
        target_id=target_id,
        name=runner["name"],
        prompt=prompt_snapshot,
    )
    evaluation_name = name or (
        f"{target['name']} — {dataset['name']} v{dataset['version']}"
    )
    evaluation_id = database.create_evaluation(
        target_id=target_id,
        dataset_id=dataset_id,
        prompt_id=prompt_id,
        name=evaluation_name,
        requested_runs=requested_runs,
        model_requested=runner["model"],
        temperature=runner["temperature"],
    )

    successes = 0
    failures = 0
    try:
        for run_number in range(1, requested_runs + 1):
            started = perf_counter()
            try:
                output = runner["execute"](dataset)
                result = output.get("result")
                performance = output.get("performance") or {}
                if not isinstance(result, dict):
                    raise ValueError("Runner returned no result object")
                if not isinstance(performance, dict):
                    raise ValueError("Runner returned invalid performance data")
            except Exception as exc:
                duration_ms = round((perf_counter() - started) * 1000)
                result_id = database.save_result(
                    evaluation_id=evaluation_id,
                    run_number=run_number,
                    status="failed",
                    actual_result=None,
                    error_message=f"{type(exc).__name__}: {exc}",
                )
                database.save_performance(
                    result_id=result_id,
                    performance={"duration_ms": duration_ms},
                )
                failures += 1
                event = {
                    "evaluation_id": evaluation_id,
                    "run_number": run_number,
                    "requested_runs": requested_runs,
                    "status": "failed",
                    "duration_ms": duration_ms,
                    "error": str(exc),
                }
            else:
                performance["duration_ms"] = round((perf_counter() - started) * 1000)
                result_id = database.save_result(
                    evaluation_id=evaluation_id,
                    run_number=run_number,
                    status="complete",
                    actual_result=result,
                )
                database.save_performance(
                    result_id=result_id,
                    performance=performance,
                )
                successes += 1
                event = {
                    "evaluation_id": evaluation_id,
                    "run_number": run_number,
                    "requested_runs": requested_runs,
                    "status": "complete",
                    "duration_ms": performance["duration_ms"],
                }

            if progress is not None:
                progress(event)

        status = (
            "complete"
            if failures == 0
            else "complete_with_failures"
            if successes > 0
            else "failed"
        )
        database.complete_evaluation(evaluation_id, status)
    except BaseException:
        database.complete_evaluation(evaluation_id, "failed")
        raise

    return {
        "evaluation_id": evaluation_id,
        "target_id": target_id,
        "dataset_id": dataset_id,
        "prompt_id": prompt_id,
        "requested_runs": requested_runs,
        "successful_runs": successes,
        "failed_runs": failures,
        "status": status,
    }
