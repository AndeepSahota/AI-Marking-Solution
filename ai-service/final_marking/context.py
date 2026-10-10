import re
from collections import Counter

# A descriptor ID's own shape encodes both the AO and the level: "ao4-3c" is
# AO4, level 3, thread "c". No lookup needed to read the level back out.
_AO_LEVEL_THREAD = re.compile(r"^([a-z0-9]+)-(\d+)([a-z]+)$")

# Double quote marks only — straight or curly. A single quote/apostrophe is
# deliberately excluded: in real OCR'd handwritten essays it's almost always
# a contraction ("doesn't", "struggle's"), not a citation — every genuine
# quotation we've found in real student work uses double quotes. Matching
# single quotes too would mistake plain contractions for a cited reference.
_QUOTATION_MARK = re.compile(r"[\"“”]")


def mark_range(value):
    match = re.fullmatch(r"\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*", str(value))
    if not match:
        raise ValueError(f"Unrecognised mark range: {value}")
    low = int(match[1])
    high = int(match[2] or match[1])
    if low > high:
        raise ValueError(f"Invalid mark range: {value}")
    return low, high


def build_final_marking_context(aggregation, scheme, thread_extraction):
    """Allowlist final-pass inputs, removing all earlier marking judgements."""
    if not isinstance(aggregation, dict) or aggregation.get("status") != "complete":
        raise ValueError("Final marking requires completed aggregation")
    if not isinstance(scheme, dict) or not isinstance(scheme.get("assessment_objectives"), list):
        raise ValueError("Final marking requires the selected structured question")
    if not isinstance(thread_extraction, dict):
        raise ValueError("Final marking requires thread descriptions")
    question_marks = scheme.get("marks")
    if type(question_marks) is not int or question_marks <= 0:
        raise ValueError("Final marking requires question marks from the selected scheme")

    supplied_objectives = thread_extraction.get("assessment_objectives", {})
    if not isinstance(supplied_objectives, dict):
        raise ValueError("Final marking requires keyed assessment-objective threads")
    objectives = []
    descriptor_threads = {}
    for objective in scheme["assessment_objectives"]:
        if not isinstance(objective, dict) or not isinstance(objective.get("ao"), str):
            raise ValueError("Final marking requires assessment-objective names")
        ao = objective["ao"]
        maximum = objective.get("marks_available")
        if type(maximum) is not int or maximum <= 0:
            raise ValueError(f"Final marking requires marks available for {ao}")
        supplied_objective = supplied_objectives.get(ao)
        if not isinstance(supplied_objective, dict) or not isinstance(supplied_objective.get("threads"), dict):
            raise ValueError(f"Final marking requires thread descriptions for {ao}")
        band_marks = supplied_objective.get("band_marks")
        if not isinstance(band_marks, list) or not band_marks:
            raise ValueError(f"Final marking requires band marks from thread extraction for {ao}")
        for band in band_marks:
            if (
                not isinstance(band, dict)
                or not isinstance(band.get("band"), str)
                or not isinstance(band.get("marks"), str)
            ):
                raise ValueError(f"Final marking requires valid band marks from thread extraction for {ao}")
            _, high = mark_range(band["marks"])
            if high > maximum:
                raise ValueError(f"Band marks exceed the maximum for {ao}")
        supplied = supplied_objective["threads"]
        threads = []
        for key, supplied_thread in supplied.items():
            thread_id = supplied_thread.get("thread_id") if isinstance(supplied_thread, dict) else None
            description = supplied_thread.get("thread_description") if isinstance(supplied_thread, dict) else None
            levels = supplied_thread.get("levels") if isinstance(supplied_thread, dict) else None
            if not isinstance(thread_id, str) or not thread_id.strip():
                raise ValueError(f"Final marking requires an ID for {ao} thread {key}")
            if not isinstance(description, str) or not description.strip():
                raise ValueError(f"Final marking requires a description for {ao} thread {key}")
            if not isinstance(levels, list) or not levels:
                raise ValueError(f"Final marking requires levels for {ao} thread {key}")
            for level in levels:
                if (
                    not isinstance(level, dict)
                    or not isinstance(level.get("descriptor_id"), str)
                    or not level["descriptor_id"].strip()
                    or not isinstance(level.get("band"), str)
                    or not level["band"].strip()
                    or not isinstance(level.get("text"), str)
                    or not level["text"].strip()
                ):
                    raise ValueError(f"Final marking requires valid levels for {ao} thread {key}")
                descriptor_id = level["descriptor_id"]
                if descriptor_id in descriptor_threads:
                    raise ValueError(f"Final marking requires unique descriptor IDs: {descriptor_id}")
                descriptor_threads[descriptor_id] = thread_id
            threads.append({
                "thread_id": thread_id,
                "thread_description": description,
                "levels": levels,
            })
        if not threads:
            raise ValueError(f"Final marking requires descriptor threads for {ao}")
        objectives.append({
            "ao": ao,
            "description": objective.get("description", ""),
            "marks_available": maximum,
            "band_marks": band_marks,
            "threads": threads,
        })

    if not objectives:
        raise ValueError("Final marking requires assessment objectives")
    source_result = aggregation.get("result")
    if not isinstance(source_result, dict) or not isinstance(source_result.get("evidence"), list):
        raise ValueError("Final marking requires an aggregation evidence catalogue")
    evidence = []
    for index, item in enumerate(source_result["evidence"], 1):
        if not isinstance(item, dict):
            raise ValueError("Final marking requires structured evidence entries")
        quote = item.get("quote")
        ids = item.get("descriptor_ids")
        if not isinstance(quote, str) or not quote.strip() or not isinstance(ids, list) or not ids:
            raise ValueError("Final marking requires quotes with descriptor matches")
        if any(not isinstance(id_, str) or id_ not in descriptor_threads for id_ in ids):
            raise ValueError("Aggregation references a descriptor outside the selected scheme")
        evidence.append({
            "evidence_id": f"e{index}",
            "quote": quote,
            "thread_ids": list(dict.fromkeys(descriptor_threads[descriptor_id] for descriptor_id in ids)),
        })

    return {
        "question": {
            "question_number": scheme.get("question_number", ""),
            "description": scheme.get("description", ""),
            "marks_available": question_marks,
        },
        "assessment_objectives": objectives,
        "evidence": evidence,
    }


def reconcile_final_score(result):
    """Make per-AO marks and maxima authoritative, retaining model totals."""
    original_score = result.get("original_score", result["score"])
    original_max_score = result.get("original_max_score", result["max_score"])
    score = sum(item["marks"] for item in result["breakdown"])
    max_score = sum(item["max_marks"] for item in result["breakdown"])
    return {
        **result,
        "score": score,
        "original_score": original_score,
        "delta": score - original_score,
        "max_score": max_score,
        "original_max_score": original_max_score,
        "max_score_delta": max_score - original_max_score,
    }


def _reference_descriptor_ids(context):
    """Every descriptor ID belonging to a thread whose own description names
    it as the reference/citation thread (e.g. "Reference selection and
    support") — AO-agnostic, since the lettering differs per mark scheme.
    """
    ids = set()
    for objective in context["assessment_objectives"]:
        for thread in objective["threads"]:
            if "reference" not in thread["thread_description"].casefold():
                continue
            for level in thread["levels"]:
                ids.add(level["descriptor_id"])
    return ids


def _strip_unsupported_reference_credit(evidence, context):
    """Drop reference-thread descriptor IDs from any evidence item whose
    quote contains no quotation mark at all.

    Real finding, not a hypothetical: aggregation and final marking were each
    independently tagging bare assertions ("this creates a sense of
    suspense and tension.") against the reference thread, crediting a
    response for citing the source when it never did. The thread's own
    definition requires an actual reference — quote fidelity is already
    strictly enforced upstream (an evidence quote is always an exact
    substring of the real essay, verified before this ever runs), so "no
    quotation mark in the quote" reliably means "nothing was actually cited
    here," not an OCR or extraction artefact.

    Only removes the reference-thread tag — every other descriptor on that
    evidence item (ideas/themes, judgement, etc.) is untouched, since a bare
    assertion can still genuinely support those.
    """
    reference_ids = _reference_descriptor_ids(context)
    stripped = []
    for item in evidence:
        if _QUOTATION_MARK.search(item["quote"]):
            stripped.append(item)
            continue
        descriptor_ids = [d for d in item["descriptor_ids"] if d not in reference_ids]
        stripped.append({**item, "descriptor_ids": descriptor_ids})
    return stripped


def _band_number(label):
    """"Level 3" -> 3. Returns None if the label has no number in it."""
    match = re.search(r"\d+", str(label))
    return int(match.group()) if match else None


def _evidence_thread_levels(evidence, ao):
    """Best level demonstrated per thread for this AO, from final marking's
    own evidence. Only threads with at least one piece of evidence appear
    as keys -- a thread with nothing at all is simply absent here, not
    present at level 0 (see _has_unaddressed_thread, which checks for that
    absence directly rather than feeding it into this).

    Deliberately sourced from final marking's OWN evidence, not stage 1's:
    stage 1 is a separate, independently fallible stage (it has under-read
    a genuinely strong essay before), so checking final marking against a
    different stage's guess risks blocking a correct answer. This only ever
    checks final marking against itself.
    """
    best_per_thread = {}
    for item in evidence:
        for descriptor_id in item["descriptor_ids"]:
            match = _AO_LEVEL_THREAD.match(descriptor_id)
            if not match or match.group(1) != ao.casefold():
                continue
            level, thread_key = int(match.group(2)), match.group(3)
            best_per_thread[thread_key] = max(best_per_thread.get(thread_key, 0), level)
    return best_per_thread


def _evidence_ceiling_band(evidence, ao):
    """The band this AO's own evidence actually supports, computed purely
    from the descriptor IDs final marking itself assigned -- independent of
    whatever band it separately wrote down.

    For each thread, takes the highest level any evidence item demonstrated
    for it (an essay's best showing on that one skill). Combines across
    threads by majority vote, tie goes to the lower band -- the same
    "round down when genuinely unsure" convention already used elsewhere in
    real mark schemes, not something invented for this check.
    """
    best_per_thread = _evidence_thread_levels(evidence, ao)
    if not best_per_thread:
        return None

    counts = Counter(best_per_thread.values())
    top_count = max(counts.values())
    tied_levels = [level for level, c in counts.items() if c == top_count]
    return min(tied_levels)


def _required_threads(context, ao):
    """Every thread_key the mark scheme defines for this AO -- the complete
    set a response could be assessed against, not just the ones its
    evidence happens to mention.
    """
    for objective in context["assessment_objectives"]:
        if objective["ao"].casefold() != ao.casefold():
            continue
        keys = set()
        for thread in objective["threads"]:
            for level in thread["levels"]:
                match = _AO_LEVEL_THREAD.match(level["descriptor_id"])
                if match:
                    keys.add(match.group(3))
        return keys
    return set()


def _has_unaddressed_thread(evidence, context, ao):
    """True if a thread the mark scheme defines for this AO has zero
    evidence at all -- not weak evidence, none.

    Deliberately not folded into the majority vote above: a thread given a
    low score there would just get outvoted by two others doing fine,
    which doesn't reflect that a required quality was never demonstrated
    at all, only that it scored low. Flagged as its own plain fact instead
    of inventing a penalty number for "completely absent".
    """
    present = _evidence_thread_levels(evidence, ao)
    required = _required_threads(context, ao)
    return bool(required - set(present))


def _needs_teacher_review(result, evidence, context):
    """True if any AO's awarded band exceeds what its own evidence supports,
    or if any AO has a required thread with no evidence at all.

    A flag, not a correction: leaves the score untouched. A wrong ceiling
    here only ever costs an unnecessary review, never silently overrides a
    score that was actually correct -- unlike capping the mark outright,
    which we deliberately chose not to do (see memory: a hard cap fixed two
    wrong essays but also broke two correct ones in testing).
    """
    for item in result["breakdown"]:
        ao = item["section"]
        ceiling = _evidence_ceiling_band(evidence, ao)
        awarded = _band_number(item["awarded_band"])
        if ceiling is not None and awarded is not None and awarded > ceiling:
            return True
        if _has_unaddressed_thread(evidence, context, ao):
            return True
    return False


def resolve_final_marking_result(result, context):
    """Check marks/references and attach source quotes without regenerating them."""
    result = reconcile_final_score(result)
    objectives = {ao["ao"]: ao for ao in context["assessment_objectives"]}
    sections = [item["section"] for item in result["breakdown"]]
    if len(sections) != len(set(sections)) or set(sections) != set(objectives):
        raise ValueError("Final marking must cover each assessment objective exactly once")
    for item in result["breakdown"]:
        objective = objectives[item["section"]]
        ranges = {band["band"]: mark_range(band["marks"]) for band in objective["band_marks"]}
        limits = ranges.get(item["awarded_band"])
        if limits is None or not limits[0] <= item["marks"] <= limits[1]:
            raise ValueError("Final mark is outside its awarded band range")
        if item["max_marks"] != objective["marks_available"]:
            raise ValueError("Final AO maximum differs from the mark scheme")
    if result["max_score"] != sum(ao["marks_available"] for ao in objectives.values()):
        raise ValueError("Final maximum differs from the mark scheme")

    sources = {item["evidence_id"]: item for item in context["evidence"]}
    selected = set()
    evidence = []
    for item in result["evidence"]:
        source = sources.get(item["evidence_id"])
        if source is None or item["evidence_id"] in selected:
            raise ValueError("Final marking returned an unknown or repeated evidence ID")
        selected.add(item["evidence_id"])
        evidence.append({**item, "quote": source["quote"]})
    if selected != set(sources):
        raise ValueError("Final marking must return every supplied evidence ID")
    if result["score"] > 0 and not evidence:
        raise ValueError("A positive final mark requires supporting evidence")
    evidence = _strip_unsupported_reference_credit(evidence, context)
    teacher_review_required = _needs_teacher_review(result, evidence, context)
    return {**result, "evidence": evidence, "teacher_review_required": teacher_review_required}
