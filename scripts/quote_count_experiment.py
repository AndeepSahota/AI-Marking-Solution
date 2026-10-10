"""
Offline experiment: does checking whether each piece of evidence actually
contains a quotation mark catch the exact bug we found by hand (a bare
assertion credited on the "reference" thread)?

For each evidence item in aggregation_result, checks whether its "quote" text
contains quotation marks anywhere inside it -- a cheap, deterministic proxy
for "did the student actually cite the source, or just assert something."
Flags any evidence item that's tagged against a reference thread (the "c"
thread, e.g. ao4-2c) despite having no quotation marks at all -- that
combination is exactly what we found by hand on essay 11.

No pipeline changes. Pure read-only analysis against data already stored.

Usage:
    python3.11 scripts/quote_count_experiment.py
"""

import json
import re
import subprocess
from pathlib import Path

MSSQL_CONTAINER = "aimira-mssql-umar"
SQL_PASSWORD = "AimiraDevingAbout123!"
DATABASE = "KlassioDatabase"
REAL_MARKS_PATH = Path(__file__).parent / "real_marks.json"

QUOTE_MARK = re.compile(r"[\"“”]")  # double quotes only — see context.py's _QUOTATION_MARK
REFERENCE_THREAD = re.compile(r"-\d+c$")  # the "c" thread == reference selection, for this AO


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


def main():
    real_marks = json.loads(REAL_MARKS_PATH.read_text())
    real_marks = {k: v for k, v in real_marks.items() if not k.startswith("_")}

    print(f"{'id':<4} {'real':<6} {'genuine refs':<14} {'bare assertions':<18} {'false reference credit?':<30}")
    print("-" * 80)

    for record_id_str, real_mark in real_marks.items():
        record_id = int(record_id_str)
        aggregation = fetch_json_column(record_id, "aggregation_result")
        evidence = aggregation.get("result", {}).get("evidence", [])

        genuine = 0
        bare = 0
        false_credits = []

        for item in evidence:
            quote = item.get("quote", "")
            has_quote_marks = bool(QUOTE_MARK.search(quote))
            descriptor_ids = item.get("descriptor_ids", [])
            tagged_reference_thread = any(REFERENCE_THREAD.search(d) for d in descriptor_ids)

            if has_quote_marks:
                genuine += 1
            else:
                bare += 1
                if tagged_reference_thread:
                    false_credits.append(quote[:50])

        flag = f"YES x{len(false_credits)}: {false_credits[0]}..." if false_credits else "no"
        print(f"{record_id:<4} {real_mark:<6} {genuine:<14} {bare:<18} {flag:<30}")


if __name__ == "__main__":
    main()
