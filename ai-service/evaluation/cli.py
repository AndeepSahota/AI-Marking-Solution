"""Terminal interface for the local AI evaluation suite."""

from __future__ import annotations

import argparse
import re
import sys
from typing import Any

from evaluation import database, importer
from evaluation.orchestrator import run_evaluation
from evaluation.runners import available_runners


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be at least 1")
    return parsed


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    if not slug:
        raise ValueError("Target name must contain at least one letter or number")
    return slug[:100]


def _required_text(value: str | None, prompt: str) -> str:
    selected = value if value is not None else input(prompt)
    selected = selected.strip()
    if not selected:
        raise ValueError(f"{prompt.rstrip(': ')} is required")
    return selected


def _select_row(
    rows: list[dict[str, Any]],
    *,
    id_field: str,
    heading: str,
    describe,
) -> dict[str, Any]:
    if not rows:
        raise ValueError(f"No {heading.lower()} are available")
    print(f"\n{heading}:")
    for row in rows:
        print(f"  {row[id_field]}. {describe(row)}")
    selected = _positive_int(input("Select ID: ").strip())
    for row in rows:
        if int(row[id_field]) == selected:
            return row
    raise ValueError(f"{heading.rstrip('s')} {selected} was not found")


def _target_from_args(target_id: int | None) -> dict[str, Any]:
    if target_id is not None:
        return database.get_target(target_id)
    return _select_row(
        database.list_targets(),
        id_field="target_id",
        heading="Targets",
        describe=lambda row: f"{row['name']} [{row['runner_key']}]",
    )


def _dataset_from_args(dataset_id: int | None) -> dict[str, Any]:
    if dataset_id is not None:
        return database.get_dataset(dataset_id)
    return _select_row(
        database.list_datasets(),
        id_field="dataset_id",
        heading="Datasets",
        describe=lambda row: f"{row['name']} v{row['version']}",
    )


def _select_runner(runner_key: str | None) -> str:
    runners = available_runners()
    keys = {key for key, _ in runners}
    if runner_key is not None:
        if runner_key not in keys:
            raise ValueError(f"Unknown runner {runner_key!r}")
        return runner_key
    print("\nRunners:")
    for index, (key, name) in enumerate(runners, 1):
        print(f"  {index}. {name} [{key}]")
    selected = _positive_int(input("Select runner: ").strip())
    if selected > len(runners):
        raise ValueError(f"Runner option {selected} was not found")
    return runners[selected - 1][0]


def _print_targets() -> None:
    rows = database.list_targets()
    if not rows:
        print("No targets have been created.")
        return
    print("ID  Runner          Key                             Name")
    for row in rows:
        print(
            f"{row['target_id']:<3} "
            f"{row['runner_key']:<15} "
            f"{row['target_key']:<31} "
            f"{row['name']}"
        )


def _print_datasets() -> None:
    rows = database.list_datasets()
    if not rows:
        print("No datasets have been imported.")
        return
    print("ID  Version  Name")
    for row in rows:
        print(
            f"{row['dataset_id']:<3} "
            f"{row['version']:<8} "
            f"{row['name']}"
        )


def _progress(event: dict[str, Any]) -> None:
    line = (
        f"Run {event['run_number']}/{event['requested_runs']}: "
        f"{event['status']} ({event['duration_ms']} ms)"
    )
    if event.get("error"):
        line += f" — {event['error']}"
    print(line, flush=True)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m evaluation.cli",
        description="Run and persist repeatable AI prompt evaluations.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    target = commands.add_parser("target", help="Manage evaluation targets")
    target_commands = target.add_subparsers(dest="target_command", required=True)
    target_commands.add_parser("list", help="List targets")
    target_create = target_commands.add_parser("create", help="Create a target")
    target_create.add_argument("--name")
    target_create.add_argument("--key")
    target_create.add_argument("--runner")
    target_create.add_argument("--description")

    dataset = commands.add_parser("dataset", help="Manage frozen datasets")
    dataset_commands = dataset.add_subparsers(dest="dataset_command", required=True)
    dataset_commands.add_parser("list", help="List reusable datasets")
    dataset_import = dataset_commands.add_parser(
        "import-prod",
        help="Import one marking result from the source SQL database",
    )
    dataset_import.add_argument("--marking-result", type=_positive_int)
    dataset_import.add_argument("--name")

    run = commands.add_parser("run", help="Run an evaluation")
    run.add_argument("--target", type=_positive_int)
    run.add_argument("--dataset", type=_positive_int)
    run.add_argument("--runs", type=_positive_int, default=10)
    run.add_argument("--name")

    dashboard = commands.add_parser(
        "dashboard",
        help="Start the local evaluation results dashboard",
    )
    dashboard.add_argument("--port", type=_positive_int, default=8010)

    evaluation = commands.add_parser("evaluation", help="Inspect evaluations")
    evaluation_commands = evaluation.add_subparsers(
        dest="evaluation_command",
        required=True,
    )
    evaluation_show = evaluation_commands.add_parser("show", help="Show one evaluation")
    evaluation_show.add_argument("evaluation_id", type=_positive_int)
    return parser


def _execute(args: argparse.Namespace) -> None:
    if args.command == "target" and args.target_command == "list":
        _print_targets()
        return

    if args.command == "target" and args.target_command == "create":
        name = _required_text(args.name, "Target name: ")
        runner_key = _select_runner(args.runner)
        target_id = database.create_target(
            target_key=args.key or _slug(name),
            name=name,
            runner_key=runner_key,
            description=args.description,
        )
        print(f"Target {target_id} created with runner {runner_key}.")
        return

    if args.command == "dataset" and args.dataset_command == "list":
        _print_datasets()
        return

    if args.command == "dataset" and args.dataset_command == "import-prod":
        marking_result_id = args.marking_result or _positive_int(
            input("Source marking result ID: ").strip()
        )
        dataset_id = importer.import_production_dataset(
            marking_result_id=marking_result_id,
            name=args.name,
        )
        print(f"Reusable dataset {dataset_id} imported and frozen.")
        return

    if args.command == "run":
        target = _target_from_args(args.target)
        dataset = _dataset_from_args(args.dataset)
        print(
            f"\nRunning {args.runs} independent calls for {target['name']} "
            f"using {dataset['name']} v{dataset['version']}..."
        )
        result = run_evaluation(
            target_id=int(target["target_id"]),
            dataset_id=int(dataset["dataset_id"]),
            requested_runs=args.runs,
            name=args.name,
            progress=_progress,
        )
        print(
            f"\nEvaluation {result['evaluation_id']} {result['status']}: "
            f"{result['successful_runs']} successful, "
            f"{result['failed_runs']} failed."
        )
        return

    if args.command == "dashboard":
        import uvicorn

        from evaluation.dashboard import app

        url = f"http://127.0.0.1:{args.port}"
        print(f"Evaluation dashboard: {url}", flush=True)
        print("Press Ctrl+C to stop it.", flush=True)
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
        return

    if args.command == "evaluation" and args.evaluation_command == "show":
        row = database.get_evaluation(args.evaluation_id)
        print(f"Evaluation: {row['evaluation_id']} — {row['name']}")
        print(f"Status: {row['status']}")
        print(f"Target: {row['target_name']} ({row['target_id']})")
        print(f"Dataset: {row['dataset_name']} ({row['dataset_id']})")
        print(f"Prompt: {row['prompt_id']}")
        print(f"Requested runs: {row['requested_runs']}")
        print(f"Results: {row['result_counts']}")
        return

    raise ValueError("Unsupported command")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        _execute(args)
        return 0
    except KeyboardInterrupt:
        print("\nEvaluation interrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
