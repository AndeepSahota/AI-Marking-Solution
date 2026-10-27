"""Build a side-by-side table from run_specialist_experiment.py --out files.
No API calls.

Usage: python3.11 scripts/compare_engines.py label=path.json [label=path.json ...]
"""

import json
import sys
from collections import Counter


def load(path):
    return {r["id"]: r for r in json.loads(open(path).read())["results"]}


def levels(r):
    return "/".join(str(r["threads"].get(k, "-")) for k in ("a", "b", "c")) if r else "-"


def _vote(levels, holistic):
    counts = Counter(levels)
    top = max(counts.values())
    tied = sorted(level for level, c in counts.items() if c == top)
    if len(tied) > 1 and holistic is not None:
        return min(tied, key=lambda level: (abs(level - holistic), level))
    return tied[0]


def flagged(r):
    """The stricter rule: flag only if the complete runs would give
    different final levels. Recomputed for older result files saved before
    review_flag existed. Threads with a single sample (current engine's A)
    count as that one level in every run."""
    if r.get("review_flag") is not None:
        return r["review_flag"]
    samples = [r["samples"][k] or [r["threads"][k]] for k in sorted(r["threads"])]
    n = max(len(s) for s in samples)
    runs = {_vote([s[i] if len(s) > 1 else s[0] for s in samples], r.get("holistic_level")) for i in range(n)}
    return len(runs) > 1


def main():
    runs = [arg.split("=", 1) for arg in sys.argv[1:]]
    data = [(label, load(path)) for label, path in runs]
    ids = sorted(set().union(*(d.keys() for _, d in data)))

    header = " | ".join(label for label, _ in data)
    abc = " | ".join(f"{label} A/B/C" for label, _ in data)
    print(f"| Essay | Teacher | {header} | {abc} |")
    print("|---" * (2 + 2 * len(data)) + "|")
    for i in ids:
        any_r = next(d[i] for _, d in data if i in d)
        teacher = f"{any_r['teacher_mark']} ({any_r['teacher_band']})"
        marks = []
        for _, d in data:
            r = d.get(i)
            if r is None:
                marks.append("-")
                continue
            tick = " ✓" if r["band"] == r["teacher_band"] else ""
            flag = " ⚑" if flagged(r) else ""
            marks.append(f"{r['marks']} ({r['band']}){tick}{flag}")
        print(f"| {i} | {teacher} | " + " | ".join(marks) + " | " + " | ".join(levels(d.get(i)) for _, d in data) + " |")

    print()
    for label, d in data:
        rows = list(d.values())
        wrong = [r for r in rows if r["band"] != r["teacher_band"]]
        flags = [r for r in rows if flagged(r)]
        print(
            f"{label}: right level {len(rows) - len(wrong)}/{len(rows)}, "
            f"within 2 marks {sum(abs(r['marks'] - r['teacher_mark']) <= 2 for r in rows)}/{len(rows)}, "
            f"flagged {len(flags)}/{len(rows)} (catching {sum(flagged(r) for r in wrong)} of {len(wrong)} wrong), "
            f"ties {sum(r.get('tie_break') is not None for r in rows)}"
        )


if __name__ == "__main__":
    main()
