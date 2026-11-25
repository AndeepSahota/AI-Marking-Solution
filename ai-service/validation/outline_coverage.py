"""Warn when the outline seems to have missed part of the paper.

The outline call sometimes stops early: on the AQA Language scheme it left
out "Section B: Transactional Writing" in 1 of 3 runs, and nothing said so --
the teacher would just not see the writing question. Two checks, both
one-sided (they can only fire when something printed is unaccounted for):

1. A "Section X" heading with no listed question in it: no question is named
   after that section and none of the outline's section starts comes after
   the section's last heading (the last, because AQA prints a "SECTION A /
   SECTION B" summary of the objectives before any question). Starts are
   placed in order, as for long papers -- a start such as "Award 1 mark for"
   repeats, and its last occurrence can sit in a later section. A question
   whose start can't be placed (the outline once gave Q4's start as just
   "Fear") counts as possibly in a section if its number or start text
   appears after that section's heading; then the section isn't flagged.
2. A question number printed in a heading ("Question 07.2") or in the first
   cell of a table row ("| Question 5 | 8 | 12 | 20 |", "| Question 7-22 |"
   -- Edexcel's marks table) that the outline doesn't have. Sub-questions
   are compared in full (7.2 is not 7.1), but "Question 27" is covered by
   27.1.

A printed paper total is not used: the model invented totals (106, 114 for
96-mark papers) that appear nowhere in the text.
"""

import re

_HEADING = re.compile(r"(?m)^[ \t]*(?:#+|\*\*)[^\n]*$")
_SECTION = re.compile(r"(?i)\bsection\s+([A-D])\b")
_QUESTION = re.compile(r"(?i)\b(?:question|q)\s*\.?\s*(\d\s\d|\d{1,2}(?:\.\d)?)\b")
_TABLE_QUESTION = re.compile(
    r"(?im)^\s*\|\s*(?:<b>)?\s*question\s+(\d{1,2}(?:\.\d)?)(?:\s*(?:-|–|or)\s*(\d{1,2}))?\s*(?:</b>)?\s*\|")
_LABEL = re.compile(r"\d\s\d\b|\d+(?:\.\d+)?")


def alnum_with_map(text: str) -> tuple[str, list[int]]:
    """Lower-case letters and digits only, with each one's index in text --
    so a section start matches whatever bold marks, pipes or spacing the
    OCR put around it."""
    chars, index = [], []
    for i, ch in enumerate(text):
        if ch.isalnum():
            chars.append(ch.casefold())
            index.append(i)
    return "".join(chars), index


def _label(raw: str) -> str:
    """"0 5" -> "5", "07.2" -> "7.2"."""
    return ".".join(str(int(part)) for part in raw.replace(" ", "").split("."))


def _numbers(label) -> set[str]:
    """"0 5" -> {"5"}, "Question 8 or 9" -> {"8", "9"}, "07.1" -> {"7.1"}."""
    return {_label(n) for n in _LABEL.findall(str(label or ""))}


def _covered(printed: str, listed: set[str]) -> bool:
    return any(printed == n or n.startswith(printed + ".") or printed.startswith(n + ".") for n in listed)


def _question_starts(clean_text: str, items: list[dict]) -> list[int | None]:
    """Where each listed question's section begins, placed in order (each
    after the one before); None for a start that is too short or not found."""
    squashed, index = alnum_with_map(clean_text)
    starts, cursor = [], 0
    for item in items:
        needle = alnum_with_map(item.get("section_start") or "")[0]
        at = squashed.find(needle, cursor) if len(needle) >= 8 else -1
        if at < 0:
            starts.append(None)
            continue
        starts.append(index[at])
        cursor = at + 1
    return starts


def _could_be_after(clean_text: str, item: dict, at: int) -> bool:
    """Whether an unplaced question might begin after position at: its start
    text or its printed number appears there."""
    after = clean_text[at:]
    start = " ".join(str(item.get("section_start") or "").split())
    if start and start.casefold() in " ".join(after.split()).casefold():
        return True
    return any(re.search(rf"(?i)\b(?:question|q)\s*\.?\s*0?{re.escape(n)}\b", after)
               for n in _numbers(item.get("printed_number") or item.get("question_number")))


def possibly_missing(clean_text: str, items: list[dict]) -> list[dict]:
    """[{"name": "Section B", "reason": ...}] for parts of the paper the
    outline seems to have missed. items: the outline's questions."""
    labels = [str(item.get(key) or "") for item in items
              for key in ("question_number", "printed_number", "description")]
    named = {letter.upper() for label in labels for letter in _SECTION.findall(label)}
    listed = set().union(*(_numbers(item.get("printed_number") or item.get("question_number")) for item in items))

    last_heading, printed = {}, set()
    for match in _HEADING.finditer(clean_text):
        heading = match.group(0)
        for letter in _SECTION.findall(heading):
            last_heading[letter.upper()] = match.start()
        printed |= {_label(n) for n in _QUESTION.findall(heading)}
    for first, last in _TABLE_QUESTION.findall(clean_text):
        if last and "." not in first and int(first) < int(last) <= int(first) + 40:
            printed |= {str(n) for n in range(int(first), int(last) + 1)}
        else:
            printed |= {_label(first)} | ({_label(last)} if last else set())

    missing = []
    starts = _question_starts(clean_text, items)
    for letter, at in sorted(last_heading.items()):
        if letter in named or any(start is not None and start > at for start in starts):
            continue
        if any(start is None and _could_be_after(clean_text, item, at) for item, start in zip(items, starts)):
            continue
        missing.append({"name": f"Section {letter}",
                        "reason": f"the mark scheme has a Section {letter} heading but no question was found in it"})
    for number in sorted((n for n in printed if not _covered(n, listed)), key=lambda n: [int(p) for p in n.split(".")]):
        missing.append({"name": f"Question {number}",
                        "reason": f"Question {number} is printed in the mark scheme but was not found"})
    return missing
