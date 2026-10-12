"""Run the specialist-architecture proposal against every real essay we have
a real teacher mark for, and compare against both the real mark and the
existing final-marking result already stored in the database.

Needs ai-service's own venv (imports security/ms_ocr_sanitisation,
llm_service) -- run from inside ai-service/, not the repo root.

Usage:
    source .venv/bin/activate && python3.11 run_specialist_experiment.py
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import re

from specialists.orchestrate import mark_ao_with_specialists

_LEVEL = re.compile(r"-(\d+)[a-z]+$")


def level_of(descriptor_id: str) -> int | None:
    match = _LEVEL.search(descriptor_id)
    return int(match.group(1)) if match else None

MSSQL_CONTAINER = "aimira-mssql-umar"
SQL_PASSWORD = "AimiraDevingAbout123!"
DATABASE = "KlassioDatabase"
REAL_MARKS_PATH = Path(__file__).parent.parent / "scripts" / "real_marks.json"


def run_sql(query: str) -> str:
    result = subprocess.run(
        [
            "docker", "exec", "-i", MSSQL_CONTAINER,
            "/opt/mssql-tools18/bin/sqlcmd",
            "-S", "localhost", "-U", "sa", "-P", SQL_PASSWORD, "-C",
            "-d", DATABASE, "-Q", query, "-y", "0", "-Y", "0",
        ],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def fetch_json(record_id: int, column: str) -> dict:
    return json.loads(run_sql(f"SET NOCOUNT ON; SELECT {column} FROM marking_results WHERE id={record_id}"))


def fetch_lesson_id(record_id: int) -> int:
    raw = run_sql(f"SET NOCOUNT ON; SELECT lesson_id FROM marking_results WHERE id={record_id}")
    return int(raw.strip())


def fetch_thread_extraction(lesson_id: int) -> dict:
    return json.loads(run_sql(f"SET NOCOUNT ON; SELECT thread_extraction FROM teacher_ocr WHERE lesson_id={lesson_id}"))


def band_of(mark: int, thresholds=((1, 3), (4, 6), (7, 9), (10, 12), (13, 15))) -> str:
    for i, (lo, hi) in enumerate(thresholds, start=1):
        if lo <= mark <= hi:
            return f"Level {i}"
    return "?"


from llm_service import SPECIALIST_MODEL, SPECIALIST_REASONING_EFFORT

# $ per 1M (input, output) tokens. gpt-4o confirmed; gpt-6-luna from
# third-party trackers (2026-10), not yet checked against OpenAI's own page.
# Ignores the cached-input discount, so it slightly overstates real spend.
PRICES = {"gpt-4o": (2.50, 10.00), "gpt-6-luna": (0.10, 0.50)}
PRICE_PER_INPUT_TOKEN = PRICES[SPECIALIST_MODEL][0] / 1_000_000
PRICE_PER_OUTPUT_TOKEN = PRICES[SPECIALIST_MODEL][1] / 1_000_000


def cost_of(prompt_tokens: int, completion_tokens: int) -> float:
    return prompt_tokens * PRICE_PER_INPUT_TOKEN + completion_tokens * PRICE_PER_OUTPUT_TOKEN


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--ids", default=None, help="comma-separated record ids, e.g. the smoke set")
    args = parser.parse_args()

    real_marks = json.loads(REAL_MARKS_PATH.read_text())
    real_marks = {k: v for k, v in real_marks.items() if not k.startswith("_")}
    if args.ids:
        wanted = args.ids.split(",")
        real_marks = {k: v for k, v in real_marks.items() if k in wanted}
    if args.limit:
        real_marks = dict(list(real_marks.items())[: args.limit])
    print(f"specialist model: {SPECIALIST_MODEL}  reasoning_effort: {SPECIALIST_REASONING_EFFORT or 'default'}")

    print(f"{'id':<5} {'real':<14} {'existing final':<16} {'specialists':<16} {'a/b/c levels':<34} {'missing':<8} {'cost':<8} {'running total':<14}")
    print("-" * 95)

    matched = 0
    total = 0
    running_cost = 0.0
    for record_id_str, real_mark in real_marks.items():
        record_id = int(record_id_str)
        lesson_id = fetch_lesson_id(record_id)
        thread_extraction = fetch_thread_extraction(lesson_id)
        questions = thread_extraction.get("questions", {})

        # All current real-marked essays are Question 4, AO4 -- generalising
        # to other questions/AOs is future work, not needed for this test.
        question_data = questions.get("Question 4")
        if not question_data or "AO4" not in question_data.get("assessment_objectives", {}):
            print(f"{record_id:<5} skipped -- no Question 4 AO4 thread data for lesson {lesson_id}")
            continue

        ao_raw = question_data["assessment_objectives"]["AO4"]
        ao = {
            "ao": "AO4",
            "marks_available": question_data["marks_available"],
            "band_marks": ao_raw["band_marks"],
            "threads": ao_raw["threads"],
        }

        student_grade = fetch_json(record_id, "student_grade")
        essay_text = student_grade.get("studentOcrText", "")
        if not essay_text:
            print(f"{record_id:<5} skipped -- no essay text stored")
            continue

        final_result = fetch_json(record_id, "final_result")
        existing_score = None
        existing_band = None
        if final_result.get("status") == "complete":
            existing_score = final_result["result"]["score"]
            existing_band = final_result["result"]["breakdown"][0]["awardedBand"]

        try:
            specialist_result = mark_ao_with_specialists(
                question="In this extract, there is an attempt to create a sense of fear and helplessness. Evaluate how successfully this is achieved. Support your views with detailed references to the text.",
                essay_text=essay_text,
                ao=ao,
            )
        except Exception as e:
            print(f"{record_id:<5} SPECIALIST RUN FAILED: {e}")
            continue

        real_str = f"{real_mark}/15 ({band_of(real_mark)})"
        existing_str = f"{existing_score}/15 ({existing_band})" if existing_score is not None else "skipped/failed"
        specialist_str = f"{specialist_result['marks']}/{specialist_result['max_marks']} ({specialist_result['awarded_band']})"
        missing_str = ",".join(specialist_result["missing_threads"]) or "-"
        per_thread_levels = {
            r["thread_key"]: level_of(r["descriptor_id"]) for r in specialist_result["per_thread"]
        }
        samples_by_thread = {r["thread_key"]: r.get("sample_levels") for r in specialist_result["per_thread"]}
        per_thread_str = " ".join(
            f"{k}={v}" + (f"{samples_by_thread[k]}".replace(" ", "") if samples_by_thread.get(k) else "")
            for k, v in sorted(per_thread_levels.items())
        )

        usage = specialist_result["usage"]
        essay_cost = cost_of(usage["prompt_tokens"], usage["completion_tokens"])
        running_cost += essay_cost

        total += 1
        matched += band_of(real_mark) == specialist_result["awarded_band"]

        print(f"{record_id:<5} {real_str:<14} {existing_str:<16} {specialist_str:<16} {per_thread_str:<34} {missing_str:<8} ${essay_cost:<7.4f} ${running_cost:<13.4f}")

    if total:
        print("-" * 95)
        print(f"Specialist-architecture band match rate: {matched}/{total} ({matched/total:.0%})")
        print(f"Total spend this run: ${running_cost:.4f} ({SPECIALIST_MODEL}, {total} essays)")


if __name__ == "__main__":
    main()
