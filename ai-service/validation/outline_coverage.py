"""Warn when the outline seems to have missed part of the paper.

The outline call sometimes stops early: on the AQA Language scheme it left
out "Section B: Transactional Writing" in 1 of 3 runs, and nothing said so --
the teacher would just not see the writing question. Two checks, both
one-sided (they can only fire when something printed is unaccounted for):

1. A "Section X" heading with no listed question in it: no question is named
   after that section and none of the outline's section starts comes after
   the section's last heading (the last, because AQA prints a "SECTION A /
   SECTION B" summary of the objectives before any question). Skipped if any
   question's start can't be placed, rather than guessed at.
2. A heading that prints a question number ("Question 7") the outline
   doesn't have.

A printed paper total is not used: the model invented totals (106, 114 for
96-mark papers) that appear nowhere in the text.
"""

import re

_HEADING = re.compile(r"(?m)^[ \t]*(?:#+|\*\*)[^\n]*$")
_SECTION = re.compile(r"(?i)\bsection\s+([A-D])\b")
_QUESTION = re.compile(r"(?i)\b(?:question|q)\s*\.?\s*(\d\s\d|\d{1,2})\b")
_NUMBER = re.compile(r"\d\s\d\b|\d+")


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


def _numbers(label) -> set[int]:
    """"0 5" -> {5}, "Question 8 or 9" -> {8, 9}, "27.1" -> {27, 1}."""
    return {int(n.replace(" ", "")) for n in _NUMBER.findall(str(label or ""))}


def _question_starts(clean_text: str, items: list[dict]) -> list[int] | None:
    """Where each listed question's section begins (its last occurrence, so a
    contents list is passed over), or None if any can't be placed."""
    squashed, index = alnum_with_map(clean_text)
    starts = []
    for item in items:
        needle = alnum_with_map(item.get("section_start") or "")[0]
        at = squashed.rfind(needle) if len(needle) >= 8 else -1
        if at < 0:
            return None
        starts.append(index[at])
    return starts


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
        printed |= {int(n.replace(" ", "")) for n in _QUESTION.findall(heading)}

    missing = []
    starts = _question_starts(clean_text, items)
    if starts is not None:
        for letter, at in sorted(last_heading.items()):
            if letter not in named and not any(start > at for start in starts):
                missing.append({"name": f"Section {letter}",
                                "reason": f"the mark scheme has a Section {letter} heading but no question was found in it"})
    for number in sorted(printed - listed):
        missing.append({"name": f"Question {number}",
                        "reason": f"Question {number} is printed in the mark scheme but was not found"})
    return missing
