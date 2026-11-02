const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value.trim() : ''

function sanitizeFeaturedEvidenceByThread(items, evidence, { checkThreadMembership = true } = {}) {
    const featured = new Map()
    if (!Array.isArray(items)) return {}

    const evidenceById = new Map(evidence.map(item => [item.evidenceId, item]))
    for (const item of items) {
        if (!isObject(item) || !Array.isArray(item.evidence_ids)) continue
        const threadId = text(item.thread_id)
        if (!threadId) continue

        const selected = featured.get(threadId) ?? []
        for (const rawEvidenceId of item.evidence_ids) {
            const evidenceId = text(rawEvidenceId)
            const candidate = evidenceById.get(evidenceId)
            if (!candidate || (checkThreadMembership && !candidate.descriptorIds.includes(threadId))) continue
            if (!selected.includes(evidenceId) && selected.length < 2) selected.push(evidenceId)
        }
        if (selected.length > 0) featured.set(threadId, selected)
    }

    return Object.fromEntries(featured)
}

const COMBINE_MODES = new Set(['calibrated', 'vote', 'current'])
const SCHEME_KEY = /^[0-9a-f]{16}$/
const smallInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

// The specialist engine's review/calibration details. Optional: anything
// missing or malformed drops the whole block (null) without invalidating the
// mark itself. fineScore and schemeKey are internal -- stored for
// calibration, never sent to a browser (the backend strips them).
export function sanitizeEngine(value, maxScore) {
    if (!isObject(value)) return null
    const nullOr = (v, check) => v === null || v === undefined || check(v)
    if (!nullOr(value.level, v => smallInt(v, 0, 20))
        || !smallInt(value.mark, 0, maxScore)
        || value.max_mark !== maxScore
        || !nullOr(value.combine_mode, v => COMBINE_MODES.has(v))
        || !nullOr(value.runs_per_thread, v => smallInt(v, 1, 20))
        || !nullOr(value.fine_score, v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20)
        || !nullOr(value.scheme_key, v => typeof v === 'string' && SCHEME_KEY.test(v))
        || typeof value.borderline !== 'boolean'
        || !nullOr(value.borderline_levels, v => Array.isArray(v) && v.length === 2
            && v.every(level => smallInt(level, 0, 20)) && v[0] < v[1])
        || !Array.isArray(value.threads) || value.threads.length > 10) return null

    const threads = []
    for (const thread of value.threads) {
        if (!isObject(thread) || !text(thread.label) || !text(thread.reason)) return null
        threads.push({ label: text(thread.label).slice(0, 100), reason: text(thread.reason).slice(0, 300) })
    }

    return {
        level: value.level ?? null,
        mark: value.mark,
        maxMark: value.max_mark,
        combineMode: value.combine_mode ?? null,
        runsPerThread: value.runs_per_thread ?? null,
        fineScore: value.fine_score ?? null,
        schemeKey: value.scheme_key ?? null,
        borderline: value.borderline,
        borderlineLevels: value.borderline_levels ?? null,
        threads,
    }
}

function sanitizeModelResult(value) {
    if (!isObject(value)
        || !Number.isInteger(value.score) || value.score < 0
        || !Number.isInteger(value.original_score) || value.original_score < 0
        || !Number.isInteger(value.delta)
        || value.original_score + value.delta !== value.score
        || !Number.isInteger(value.max_score) || value.max_score < 1
        || !Number.isInteger(value.original_max_score) || value.original_max_score < 1
        || !Number.isInteger(value.max_score_delta)
        || value.original_max_score + value.max_score_delta !== value.max_score
        || !text(value.summary)
        || !Array.isArray(value.breakdown) || value.breakdown.length === 0
        || !Array.isArray(value.evidence)) return null

    const breakdown = []
    for (const item of value.breakdown) {
        if (!isObject(item) || !text(item.section) || !text(item.awarded_band)
            || !text(item.summary)
            || !Number.isInteger(item.marks) || item.marks < 0
            || !Number.isInteger(item.max_marks) || item.max_marks < 1) return null
        breakdown.push({
            section: text(item.section),
            awardedBand: text(item.awarded_band),
            marks: item.marks,
            maxMarks: item.max_marks,
            summary: text(item.summary),
        })
    }

    const evidence = []
    for (const item of value.evidence) {
        if (!isObject(item) || !text(item.evidence_id)
            || !text(item.explanation) || !text(item.summary)
            || !Array.isArray(item.descriptor_ids) || item.descriptor_ids.length === 0
            || item.descriptor_ids.some(id => !text(id))) return null
        evidence.push({
            evidenceId: text(item.evidence_id),
            descriptorIds: [...new Set(item.descriptor_ids.map(text))],
            explanation: text(item.explanation),
            summary: text(item.summary),
        })
    }

    return {
        score: value.score,
        originalScore: value.original_score,
        delta: value.delta,
        maxScore: value.max_score,
        originalMaxScore: value.original_max_score,
        maxScoreDelta: value.max_score_delta,
        summary: text(value.summary),
        breakdown,
        evidence,
        featuredEvidenceByThread: sanitizeFeaturedEvidenceByThread(
            value.featured_evidence_by_thread, evidence, { checkThreadMembership: false }
        ),
    }
}

export function sanitizeFinalResult(value) {
    if (!isObject(value)) return null
    if (value.status === 'skipped' || value.status === 'failed') {
        const modelResult = value.status === 'failed'
            ? sanitizeModelResult(value.model_result)
            : null
        return {
            status: value.status,
            reason: text(value.reason).slice(0, 1000),
            ...(modelResult ? { modelResult } : {}),
        }
    }

    const invalid = { status: 'failed', reason: 'Invalid final marking result' }
    const result = value.result
    if (value.status !== 'complete' || !isObject(result)) return invalid
    if (!Number.isInteger(result.score) || !Number.isInteger(result.max_score)
        || result.max_score < 1 || result.score < 0 || result.score > result.max_score
        || !text(result.summary)
        || !Array.isArray(result.breakdown) || result.breakdown.length === 0
        || !Array.isArray(result.evidence)
        || typeof result.teacher_review_required !== 'boolean') return invalid

    const breakdown = []
    const sections = new Set()
    for (const item of result.breakdown) {
        if (!isObject(item) || !text(item.section) || !text(item.awarded_band)
            || !text(item.summary) || sections.has(item.section)
            || !Number.isInteger(item.marks) || !Number.isInteger(item.max_marks)
            || item.max_marks < 1 || item.marks < 0 || item.marks > item.max_marks) return invalid
        sections.add(item.section)
        breakdown.push({
            section: text(item.section),
            awardedBand: text(item.awarded_band),
            marks: item.marks,
            maxMarks: item.max_marks,
            summary: text(item.summary),
        })
    }
    if (breakdown.reduce((sum, item) => sum + item.marks, 0) !== result.score
        || breakdown.reduce((sum, item) => sum + item.maxMarks, 0) !== result.max_score) return invalid

    if (!Number.isInteger(result.original_score) || result.original_score < 0
        || !Number.isInteger(result.delta)
        || result.original_score + result.delta !== result.score
        || !Number.isInteger(result.original_max_score) || result.original_max_score < 1
        || !Number.isInteger(result.max_score_delta)
        || result.original_max_score + result.max_score_delta !== result.max_score) return invalid

    const evidence = []
    const evidenceIds = new Set()
    for (const item of result.evidence) {
        if (!isObject(item) || !text(item.evidence_id) || evidenceIds.has(item.evidence_id)
            || !text(item.quote) || !text(item.explanation) || !text(item.summary)
            || !Array.isArray(item.descriptor_ids) || item.descriptor_ids.length === 0
            || item.descriptor_ids.some(id => !text(id))) return invalid
        evidenceIds.add(item.evidence_id)
        evidence.push({
            evidenceId: text(item.evidence_id),
            quote: item.quote,
            descriptorIds: [...new Set(item.descriptor_ids.map(text))],
            explanation: text(item.explanation),
            summary: text(item.summary),
        })
    }
    if (result.score > 0 && evidence.length === 0) return invalid

    return {
        status: 'complete',
        result: {
            score: result.score,
            originalScore: result.original_score,
            delta: result.delta,
            maxScore: result.max_score,
            originalMaxScore: result.original_max_score,
            maxScoreDelta: result.max_score_delta,
            percentage: Math.round(result.score / result.max_score * 100),
            summary: text(result.summary),
            teacherReviewRequired: result.teacher_review_required,
            breakdown,
            evidence,
            featuredEvidenceByThread: sanitizeFeaturedEvidenceByThread(
                result.featured_evidence_by_thread, evidence
            ),
            engine: sanitizeEngine(result.engine, result.max_score),
        },
    }
}
