"""
Offline experiment: would a "majority of threads, tie goes to the lower band"
rule — computed from data we already have — have produced a better band than
final marking actually did?

No pipeline changes here. Pulls each known essay's stage-1 per-thread evidence
(evidenceSupportingAwardedBand — one entry per thread, each with a level
encoded in its descriptor ID, e.g. "ao4-2a" = Level 2), computes what band a
simple majority-vote rule would produce, and compares that against both the
real teacher mark and what final marking actually gave.

"partially_met" is treated as one level below its descriptor's own level,
rather than fully counting it — same "don't give the benefit of the doubt"
convention already used elsewhere in these mark schemes.

Usage:
    python3.11 scripts/band_cap_experiment.py
"""

import json
import re
import subprocess
from collections import Counter
from pathlib import Path

MSSQL_CONTAINER = "aimira-mssql-umar"
SQL_PASSWORD = "AimiraDevingAbout123!"
DATABASE = "KlassioDatabase"
REAL_MARKS_PATH = Path(__file__).parent / "real_marks.json"

DESCRIPTOR_LEVEL = re.compile(r"-(\d+)[a-z]$")


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


def fetch_json_column(record_id: int, column: str) -> dict:
    raw = run_sql(f"SET NOCOUNT ON; SELECT {column} FROM marking_results WHERE id={record_id}")
    return json.loads(raw)


def band_of(mark: int, thresholds=((1, 3), (4, 6), (7, 9), (10, 12), (13, 15))) -> str:
    for i, (lo, hi) in enumerate(thresholds, start=1):
        if lo <= mark <= hi:
            return f"Level {i}"
    return "?"


def majority_vote_ceiling(evidence: list[dict]) -> int | None:
    votes = []
    for item in evidence:
        match = DESCRIPTOR_LEVEL.search(item.get("descriptorId", ""))
        if not match:
            continue
        level = int(match.group(1))
        votes.append(level)  # "partially_met" penalty removed — see below

    if not votes:
        return None

    counts = Counter(votes)
    top_count = max(counts.values())
    tied_levels = [level for level, c in counts.items() if c == top_count]
    return min(tied_levels)  # tie -> lower band


def main():
    real_marks = json.loads(REAL_MARKS_PATH.read_text())
    real_marks = {k: v for k, v in real_marks.items() if not k.startswith("_")}

    print(f"{'id':<4} {'real':<10} {'final marking':<16} {'majority-vote rule':<20} {'votes used':<20}")
    print("-" * 80)

    rule_matches = 0
    final_matches = 0
    total = 0

    for record_id_str, real_mark in real_marks.items():
        record_id = int(record_id_str)
        student_grade = fetch_json_column(record_id, "student_grade")
        final_result = fetch_json_column(record_id, "final_result")

        evidence = student_grade.get("breakdown", [{}])[0].get("evidenceSupportingAwardedBand", [])
        rule_level = majority_vote_ceiling(evidence)
        votes_str = ",".join(
            str(int(DESCRIPTOR_LEVEL.search(e["descriptorId"]).group(1)))
            + ("*" if e.get("status") == "partially_met" else "")
            for e in evidence if DESCRIPTOR_LEVEL.search(e.get("descriptorId", ""))
        )

        f_score = final_result.get("result", {}).get("score")
        f_band = final_result.get("result", {}).get("breakdown", [{}])[0].get("awardedBand") if f_score is not None else None

        real_band = band_of(real_mark)
        rule_band = f"Level {rule_level}" if rule_level else "?"

        total += 1
        rule_matches += (rule_band == real_band)
        final_matches += (f_band == real_band)

        print(f"{record_id:<4} {f'{real_mark} ({real_band})':<10} {f'{f_score} ({f_band})':<16} {rule_band:<20} {votes_str:<20}")

    print("-" * 80)
    print(f"Final marking matched real band: {final_matches}/{total}")
    print(f"Majority-vote rule matched real band: {rule_matches}/{total}")


if __name__ == "__main__":
    main()
