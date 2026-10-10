"""
Does the same false-reference-credit bug show up independently in final
marking's own output, or only at aggregation? Final marking assigns its own
descriptor_ids from scratch (it doesn't just copy aggregation's), so this
needs checking separately -- tells us whether the fix needs to live in one
place or two.
"""

import json
import re
import subprocess

QUOTE_MARK = re.compile(r"[\"'‘’“”]")
REFERENCE_THREAD = re.compile(r"-thread-c$")


def run_sql(query: str) -> dict:
    out = subprocess.run(
        [
            "docker", "exec", "-i", "aimira-mssql-umar",
            "/opt/mssql-tools18/bin/sqlcmd",
            "-S", "localhost", "-U", "sa", "-P", "AimiraDevingAbout123!", "-C",
            "-d", "KlassioDatabase", "-Q", query, "-y", "0", "-Y", "0",
        ],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


for rid in [11, 15]:
    final = run_sql(f"SET NOCOUNT ON; SELECT final_result FROM marking_results WHERE id={rid}")
    evidence = final.get("result", {}).get("evidence", [])
    print(f"=== record {rid} (final marking) ===")
    for item in evidence:
        quote = item.get("quote", "")
        has_quote = bool(QUOTE_MARK.search(quote))
        ids = item.get("descriptorIds", [])
        tagged_ref = any(REFERENCE_THREAD.search(d) for d in ids)
        flag = "  <-- FALSE CREDIT" if (not has_quote and tagged_ref) else ""
        print(f"  quote_marks={has_quote} ids={ids}{flag}")
