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
