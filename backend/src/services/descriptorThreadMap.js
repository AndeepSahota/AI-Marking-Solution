// Return only the descriptor-to-thread IDs needed by the feedback page, not
// the selected question's full thread extraction (descriptions and levels).
export function selectedDescriptorThreads(rawThreadExtraction, questionNumber) {
    if (!rawThreadExtraction || typeof questionNumber !== 'string' || !questionNumber.trim()) {
        return {}
    }

    let extracted
    try {
        extracted = typeof rawThreadExtraction === 'string'
            ? JSON.parse(rawThreadExtraction)
            : rawThreadExtraction
    } catch { return {} }

    const question = extracted?.questions?.[questionNumber.trim()]
    const objectives = question?.assessment_objectives
    if (!objectives || typeof objectives !== 'object' || Array.isArray(objectives)) return {}

    const descriptorThreads = new Map()
    for (const objective of Object.values(objectives)) {
        const threads = objective?.threads
        if (!threads || typeof threads !== 'object' || Array.isArray(threads)) continue

        for (const thread of Object.values(threads)) {
            if (typeof thread?.thread_id !== 'string' || !thread.thread_id.trim()
                || !Array.isArray(thread.levels)) continue
            for (const level of thread.levels) {
                const descriptorId = level?.descriptor_id
                if (typeof descriptorId !== 'string' || !descriptorId.trim()) continue
                const existingThread = descriptorThreads.get(descriptorId)
                // An ambiguous mapping must not attach evidence to the wrong
                // displayed descriptor.
                if (existingThread && existingThread !== thread.thread_id) return {}
                descriptorThreads.set(descriptorId, thread.thread_id)
            }
        }
    }

    return Object.fromEntries(descriptorThreads)
}
