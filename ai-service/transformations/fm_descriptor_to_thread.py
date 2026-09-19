"""Replace final-marking evidence descriptor IDs with their stored thread IDs."""


def fm_descriptor_to_thread(result: dict, context: dict) -> dict:
    """Keep ``descriptor_ids`` as the output field, but make its values thread IDs.

    The final marker chooses descriptor IDs. The selected question's thread
    extraction, already present in the final context, is the source of truth
    for which thread each descriptor belongs to. Source order is retained and
    repeated levels within the same thread collapse to one thread ID.
    """
    descriptor_threads = {}
    for objective in context["assessment_objectives"]:
        for thread in objective["threads"]:
            thread_id = thread["thread_id"]
            for level in thread["levels"]:
                descriptor_id = level["descriptor_id"]
                if descriptor_id in descriptor_threads:
                    raise ValueError(f"Descriptor belongs to multiple threads: {descriptor_id}")
                descriptor_threads[descriptor_id] = thread_id

    evidence = []
    for item in result["evidence"]:
        thread_ids = []
        for descriptor_id in item["descriptor_ids"]:
            thread_id = descriptor_threads.get(descriptor_id)
            if thread_id is None:
                raise ValueError(f"Final evidence contains an unknown descriptor ID: {descriptor_id}")
            if thread_id not in thread_ids:
                thread_ids.append(thread_id)
        evidence.append({**item, "descriptor_ids": thread_ids})

    return {**result, "evidence": evidence}
