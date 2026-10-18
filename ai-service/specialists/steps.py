"""Derive a thread's level from the specialist's tested steps.

Pure code, no LLM call. The specialist only reports, for each boundary
between adjacent levels, whether a quote demonstrates what the higher level
adds. Climbing stops at the first boundary without one -- the "don't give
the benefit of the doubt" rule, enforced here rather than requested in the
prompt, since prompting for self-consistency was already shown not to bind
the model's final band choice.

Returns the same {descriptor_id, reasoning, evidence} shape the older
single-choice specialist returned, so combine.py, resolve.py and the
frontend need no changes.
"""


def resolve_level_from_steps(steps: list[dict], levels: list[dict], student_response: str) -> dict:
    """steps: the specialist's raw steps. levels: the thread's levels, lowest
    first, exactly as supplied to the specialist. student_response: the
    delimited text the specialist was given, used to reject any quote that
    is not an exact substring of it.

    Steps are looked up by their (from, to) pair rather than trusted by
    position, so a missing, misordered or invented step is simply treated as
    not earned -- it can only ever lower the level, never raise it.
    """
    by_pair = {(step["from_descriptor_id"], step["to_descriptor_id"]): step for step in steps}
    ids = [level["descriptor_id"] for level in levels]
    pairs = [(None, ids[0])] + list(zip(ids, ids[1:]))

    descriptor_id = ids[0]
    evidence = []
    reasoning = []
    for from_id, to_id in pairs:
        step = by_pair.get((from_id, to_id))
        if step is None:
            reasoning.append(f"{from_id} -> {to_id}: step not returned; stopped here.")
            break
        quote = step["quote"]
        if not quote or quote not in student_response:
            reasoning.append(f"{from_id} -> {to_id}: not earned. {step['explanation']}")
            break
        descriptor_id = to_id
        evidence.append({"quote": quote, "explanation": step["explanation"]})
        reasoning.append(f"{from_id} -> {to_id}: earned. {step['explanation']}")

    return {
        "descriptor_id": descriptor_id,
        "reasoning": " ".join(reasoning),
        "evidence": evidence,
        "steps": steps,
    }


# Thread C's own descriptor vocabulary -- these words are fine in
# `descriptor_phrase_matched` (that field exists for exactly this), but if
# they leak into `what_student_does` or `why_this_meets_criterion`, the
# model has slipped back into restating the label instead of describing
# the actual evidence. Hardcoded to thread C's real descriptor wording
# rather than derived automatically -- fine while only one thread uses this
# pattern; worth deriving from the supplied level text directly if another
# thread adopts it later.
_REFERENCE_DESCRIPTOR_WORDS = (
    "valid", "developed", "appropriate", "relevant",
    "detailed", "persuasive", "apt", "discriminating",
)


def _leaks_descriptor_wording(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in _REFERENCE_DESCRIPTOR_WORDS)


def resolve_reference_level_from_steps(steps: list[dict], levels: list[dict], student_response: str) -> dict:
    """Same climbing logic as resolve_level_from_steps, for thread C's
    four-field step shape (see schemas.thread_specialist_result.
    ReferenceSpecialistStep).

    Does NOT hard-reject a step just because what/why leak the level
    descriptor's own vocabulary -- tried that first and it overcorrected,
    rejecting real Level-4 essays down to Level 1 whenever the model let a
    single banned word slip into an otherwise fine explanation. Still
    computed and flagged in the reasoning trail (visible, not silent), on
    the bet that the four-field structure alone -- giving the model a
    legitimate place for descriptor wording -- improves genuine reasoning
    quality without needing to police it this bluntly in code.
    """
    by_pair = {(step["from_descriptor_id"], step["to_descriptor_id"]): step for step in steps}
    ids = [level["descriptor_id"] for level in levels]
    pairs = [(None, ids[0])] + list(zip(ids, ids[1:]))

    descriptor_id = ids[0]
    evidence = []
    reasoning = []
    for from_id, to_id in pairs:
        step = by_pair.get((from_id, to_id))
        if step is None:
            reasoning.append(f"{from_id} -> {to_id}: step not returned; stopped here.")
            break
        quote = step["quote"]
        what = step.get("what_student_does") or ""
        why = step.get("why_this_meets_criterion") or ""
        matched = step.get("descriptor_phrase_matched") or ""
        if not quote or quote not in student_response:
            reasoning.append(f"{from_id} -> {to_id}: not earned. No valid quote.")
            break
        leaked = _leaks_descriptor_wording(what) or _leaks_descriptor_wording(why)
        explanation = f"{what} {why} (matches: {matched})".strip()
        descriptor_id = to_id
        evidence.append({"quote": quote, "explanation": explanation})
        note = " [NOTE: descriptor wording leaked into what/why -- not rejected, just flagged]" if leaked else ""
        reasoning.append(f"{from_id} -> {to_id}: earned. {explanation}{note}")

    return {
        "descriptor_id": descriptor_id,
        "reasoning": " ".join(reasoning),
        "evidence": evidence,
        "steps": steps,
    }
