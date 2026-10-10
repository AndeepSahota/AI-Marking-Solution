"""
Compare KLASSIO's AI marks against real teacher marks.

Replaces doing this by hand with sqlcmd every time: pulls every marking_results
row (across all lessons by default, since student slots get reused between
lessons), shows what stage 1 (holistic) and stage 3 (final marking) each
awarded, and lines that up against the real mark a human teacher gave, read
from real_marks.json.

real_marks.json is keyed by the marking_results row's own "id" column, NOT
student_id or lesson_id — student IDs get reused across different lessons
(e.g. student 1 has marked essays in both lesson 4 and lesson 5), so keying
by student_id alone would silently apply the wrong real mark to one of them.
The row "id" printed in this script's own output is always unique.

Usage:
    python3 scripts/compare_marks.py              # every lesson
    python3 scripts/compare_marks.py --lesson-id 4 # just one lesson
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

MSSQL_CONTAINER = "aimira-mssql-umar"
SQL_PASSWORD = "AimiraDevingAbout123!"
DATABASE = "KlassioDatabase"
REAL_MARKS_PATH = Path(__file__).parent / "real_marks.json"


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


def fetch_rows(lesson_id: int | None) -> list[dict]:
    where = f"WHERE m.lesson_id={lesson_id} " if lesson_id is not None else ""
    raw = run_sql(
        f"SET NOCOUNT ON; SELECT m.id, m.lesson_id, m.student_id, s.student_name "
        f"FROM marking_results m JOIN students s ON s.id = m.student_id "
        f"{where}ORDER BY m.id"
    )
    rows = []
    for line in raw.splitlines():
        parts = line.split(maxsplit=3)
        if len(parts) == 4 and all(p.isdigit() for p in parts[:3]):
            rows.append({
                "id": int(parts[0]),
                "lesson_id": int(parts[1]),
                "student_id": int(parts[2]),
                "name": parts[3].strip(),
            })
    return rows


def fetch_json_column(record_id: int, column: str) -> dict:
    raw = run_sql(
        f"SET NOCOUNT ON; SELECT {column} FROM marking_results WHERE id={record_id}"
    )
    return json.loads(raw)


def extract_holistic(student_grade: dict) -> tuple[int, str]:
    breakdown = student_grade.get("breakdown", [{}])[0]
    return student_grade.get("score"), breakdown.get("awardedBand")


def extract_final(final_result: dict) -> tuple[int | None, str | None, bool | None]:
    if final_result.get("status") != "complete":
        return None, None, None
    result = final_result["result"]
    breakdown = result.get("breakdown", [{}])[0]
    # Absent on any record marked before the ceiling-flag code went live --
    # distinct from an explicit False, so shown as "-" rather than "no".
    return result.get("score"), breakdown.get("awardedBand"), result.get("teacherReviewRequired")


def band_of(mark: int, thresholds=((1, 3), (4, 6), (7, 9), (10, 12), (13, 15))) -> str:
    for i, (lo, hi) in enumerate(thresholds, start=1):
        if lo <= mark <= hi:
            return f"Level {i}"
    return "?"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lesson-id", type=int, default=None)
    args = parser.parse_args()

    real_marks = json.loads(REAL_MARKS_PATH.read_text())
    real_marks = {k: v for k, v in real_marks.items() if not k.startswith("_")}

    rows = fetch_rows(args.lesson_id)
    if not rows:
        print("No marking_results found")
        sys.exit(1)

    print(f"{'id':<4} {'lesson':<7} {'student':<10} {'real':<12} {'stage1 (holistic)':<20} {'stage3 (final)':<20} {'ceiling flag':<13} {'delta (real->final)':<20}")
    print("-" * 118)

    matched = 0
    total_with_real = 0
    for row in rows:
        record_id = row["id"]
        name = row["name"]
        student_grade = fetch_json_column(record_id, "student_grade")
        final_result = fetch_json_column(record_id, "final_result")

        h_score, h_band = extract_holistic(student_grade)
        f_score, f_band, needs_review = extract_final(final_result)

        real = real_marks.get(str(record_id))
        real_str = f"{real}/15 ({band_of(real)})" if real is not None else "? (add id to real_marks.json)"

        h_str = f"{h_score}/15 ({h_band})" if h_score is not None else "-"
        f_str = f"{f_score}/15 ({f_band})" if f_score is not None else "skipped/failed"
        flag_str = "n/a (predates)" if needs_review is None else ("FLAGGED" if needs_review else "clear")

        if real is not None and f_score is not None:
            total_with_real += 1
            delta = f_score - real
            band_match = band_of(real) == f_band
            matched += band_match
            band_flag = "" if band_match else "  <-- BAND MISMATCH"
            delta_str = f"{delta:+d} marks{band_flag}"
        else:
            delta_str = "-"

        print(f"{record_id:<4} {row['lesson_id']:<7} {name:<10} {real_str:<12} {h_str:<20} {f_str:<20} {flag_str:<13} {delta_str:<20}")

    if total_with_real:
        print("-" * 118)
        print(f"Band match rate: {matched}/{total_with_real} ({matched/total_with_real:.0%})")


if __name__ == "__main__":
    main()
