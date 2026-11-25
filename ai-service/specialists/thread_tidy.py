"""Tidy an objective's threads before the general engine marks a
multi-objective question (specialists/parts.py). Single-objective questions
never come through here, so AO4's threads -- and its calibration
fingerprint -- are untouched.

On AQA writing grids the thread split made 7 AO5 + 6 AO6 threads, several
of them overlapping and one of them junk:
- a heading-only thread: every level just says "Content" (the grid's column
  heading read in as a point) -- dropped;
- a heading glued onto every level ("...linguistic devicesOrganisation") --
  stripped;
- overlapping threads (communication / tone and register; structure /
  paragraphing) -- merged by the groups chosen at the scheme step
  (``thread_groups``, scheme_extraction.py), level by level, keeping each
  member's wording word for word.
"""

import re

_LEVEL = re.compile(r"-(\d+)[a-z]+$")
_GLUED_HEADING = re.compile(r"(?<=[a-z])([A-Z][a-z]+)\s*$")
_MAX_HEADING_WORDS = 3


def _texts(thread: dict) -> list[str]:
    return [str(level.get("text") or "") for level in thread.get("levels") or []]


def is_heading_thread(thread: dict) -> bool:
    """Every level says the same 1-3 words: a heading, not a criterion."""
    texts = [" ".join(t.split()).casefold() for t in _texts(thread)]
    return len(texts) >= 2 and len(set(texts)) == 1 and 0 < len(texts[0].split()) <= _MAX_HEADING_WORDS


def strip_glued_heading(thread: dict) -> dict:
    """A copy without a capitalised word glued onto the end of EVERY level
    ("devicesOrganisation"); unchanged unless all levels share it."""
    matches = [_GLUED_HEADING.search(t) for t in _texts(thread)]
    if len(matches) < 2 or not all(matches) or len({m.group(1) for m in matches}) != 1:
        return thread
    return {**thread, "levels": [
        {**level, "text": str(level.get("text"))[:match.start()].rstrip()}
        for level, match in zip(thread["levels"], matches)
    ]}


def valid_groups(groups: object, keys: list[str]) -> list[list[str]] | None:
    """groups if it uses every key exactly once, else None."""
    if not isinstance(groups, list) or not all(isinstance(g, list) and g for g in groups):
        return None
    flat = [key for group in groups for key in group]
    return groups if sorted(flat) == sorted(keys) and len(flat) == len(set(flat)) else None


def repair_groups(groups: object, keys: list[str], max_groups: int) -> list[list[str]] | None:
    """A model's grouping made usable without inventing anything: a key
    repeated in a later group is dropped there, unknown keys are dropped,
    and a key left out gets a group of its own. None if that leaves more
    than max_groups groups."""
    if not isinstance(groups, list):
        return None
    seen, repaired = set(), []
    for group in groups:
        kept = [key for key in (group if isinstance(group, list) else []) if key in keys and key not in seen]
        seen.update(kept)
        if kept:
            repaired.append(kept)
    repaired += [[key] for key in keys if key not in seen]
    return repaired if len(repaired) <= max_groups else None


def _level_number(level: dict) -> int | None:
    match = _LEVEL.search(str(level.get("descriptor_id") or ""))
    return int(match.group(1)) if match else None


def merge_threads(threads: dict, group: list[str]) -> tuple[str, dict]:
    """(key, thread) for several threads marked as one: level N's text is
    each member's level-N text joined with "; ", under the first member's
    descriptor ID for that level."""
    if len(group) == 1:
        return group[0], threads[group[0]]
    by_level: dict[int, list[dict]] = {}
    for key in group:
        for level in threads[key].get("levels") or []:
            by_level.setdefault(_level_number(level), []).append(level)
    levels = [{
        **members[0],
        "text": "; ".join(str(m.get("text") or "").strip().rstrip(".;") for m in members),
    } for number, members in sorted(by_level.items(), key=lambda item: (item[0] is None, item[0] or 0))]
    description = "; ".join(str(threads[k].get("thread_description") or "").strip().rstrip(".") for k in group)
    return "+".join(group), {**threads[group[0]], "thread_description": description, "levels": levels}


def tidy_threads(ao_data: dict) -> dict:
    """The threads the engine should mark for this objective."""
    threads = {key: strip_glued_heading(thread) for key, thread in (ao_data.get("threads") or {}).items()
               if not is_heading_thread(thread)}
    groups = valid_groups(ao_data.get("thread_groups"), list(threads))
    if not groups:
        return threads
    return dict(merge_threads(threads, group) for group in groups)
