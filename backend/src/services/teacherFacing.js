// What GET /lessons/:id/results may show a teacher on the Feedback page.
// Teachers see the overall level and mark, plain-English reasons and the
// evidence quotes. Never descriptor codes (ao4-3a), per-skill level lines,
// thread names or calibration wording: in calibrated mode the per-skill
// levels sit on a different scale from the overall level, so showing them
// contradicts the mark (e.g. every skill "Level 2", overall Level 1).
// Same rule as the AI service's resolve._teacher_reason.
import { stripEngineInternals } from './reviewService.js'

const INTERNAL_SENTENCE = /\blevel\s*\d|\bao\d+-\d+[a-z]+\b|\bthread\b|\bspecialist|\bcalibrat|\bfine score/i

// Drops every sentence that mentions an internal; keeps the rest as written.
export function teacherText(text) {
    if (typeof text !== 'string') return ''
    // A sentence ends at . ! or ? followed by a space, so "2.4" and
    // "settings.: Level 2" (a skill joined to its level) stay whole.
    return text.replace(/\s*\(matches:.*?\)/g, '')
        .split(/(?<=[.!?]["'”’)]*)\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence && !INTERNAL_SENTENCE.test(sentence))
        .join(' ')
}

const cleanEvidence = evidence => Array.isArray(evidence)
    ? evidence.map(item => ({
        evidenceId: item.evidenceId ?? item.evidence_id,
        quote: item.quote,
        summary: teacherText(item.summary),
        explanation: teacherText(item.explanation),
    }))
    : evidence

// Every text field is cleaned except the AO name and the overall level awarded.
const KEEP_AS_IS = new Set(['section', 'awardedBand'])

// The holistic marker's per-descriptor evidence lists are built from codes
// and level lines throughout, and the Feedback page doesn't show them.
const DROPPED_BREAKDOWN_FIELDS = new Set(['evidenceSupportingAwardedBand', 'nextBandRequirementNotMet'])

const cleanBreakdown = breakdown => Array.isArray(breakdown)
    ? breakdown.map(item => Object.fromEntries(Object.entries(item)
        .filter(([key]) => !DROPPED_BREAKDOWN_FIELDS.has(key))
        .map(([key, value]) =>
            [key, typeof value === 'string' && !KEEP_AS_IS.has(key) ? teacherText(value) : value])))
    : breakdown

const cleanList = list => Array.isArray(list)
    ? list.map(teacherText).filter(Boolean)
    : list

// One marking result (holistic, aggregation or final): the teacher-facing copy.
export function teacherFacingResult(result) {
    if (!result || typeof result !== 'object') return result
    const { featuredEvidenceByThread: _threads, ...rest } = result
    return {
        ...rest,
        ...(typeof result.summary === 'string' && { summary: teacherText(result.summary) }),
        ...(typeof result.feedback === 'string' && { feedback: teacherText(result.feedback) }),
        ...(Array.isArray(result.actionableSteps) && { actionableSteps: cleanList(result.actionableSteps) }),
        breakdown: cleanBreakdown(result.breakdown),
        evidence: cleanEvidence(result.evidence),
    }
}

// The { status, result } envelope used by aggregation_result and final_result.
// modelResult (the raw output kept when a result fails validation) is never
// shown, so it is dropped rather than cleaned.
export function teacherFacingEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') return envelope
    const { modelResult: _raw, ...rest } = stripEngineInternals(envelope)
    return {
        ...rest,
        ...(typeof rest.reason === 'string' && { reason: teacherText(rest.reason) }),
        ...(rest.result && { result: teacherFacingResult(rest.result) }),
    }
}
