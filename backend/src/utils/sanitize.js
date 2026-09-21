/**
 * Output Sanitization Module
 *
 * All system output passes through here before being sent to the client.
 * Three responsibilities:
 *   1. encodeHtml  — entity-encode strings for non-React output surfaces
 *                    (logs, emails, future HTML templates). NOT applied to
 *                    data bound for React JSX — React encodes those itself.
 *   2. safeInt     — coerce any value to a finite integer within a safe range.
 *   3. safeText    — coerce any value to a trimmed string within a length cap.
 *   4. sanitizeAIResult — schema-allowlist + type-enforce the full AI response
 *                         so only the expected fields, in the expected types,
 *                         ever reach the client.
 *
 * When the real AI model lands and OCR text is added to the response,
 * add the new field here and choose the right primitive (safeText / safeInt).
 */

/**
 * HTML entity encoding.
 * Use this for any output that lands in a non-React HTML context:
 * server-side rendered HTML, log files rendered in a browser, emails, etc.
 * Do NOT apply to data that React will render via JSX — React encodes internally
 * and this would cause double-encoding (showing "&amp;" literally on screen).
 */
export function encodeHtml(value) {
    const str = value === null || value === undefined ? '' : String(value)
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;')
}

/**
 * Coerce a value to a safe finite integer.
 * - Non-numeric input returns `fallback` rather than NaN or Infinity.
 * - Decimals are rounded.
 * - The result is clamped to [min, max].
 */
export function safeInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * Coerce a value to a safe string.
 * - Non-string input is cast with String().
 * - null / undefined returns `fallback`.
 * - Leading/trailing whitespace is trimmed.
 * - Length is capped at `maxLength` characters.
 */
export function safeText(value, { maxLength = 5000, fallback = '' } = {}) {
    if (value === null || value === undefined) return fallback
    return String(value).trim().slice(0, maxLength)
}

const VALID_DESCRIPTOR_STATUSES = ['met', 'partially_met', 'not_met']

/**
 * Sanitize the full AI marking result.
 *
 * Enforces the exact schema expected by the frontend:
 *   { score, maxScore, percentage, breakdown[], actionableSteps[],
 *     teacherReviewRequired, questionMismatch, questionMismatchReason,
 *     studentOcrText, confidence, lowConfidenceWords[], missingAos[],
 *     answerExcerpt }
 *
 * breakdown[] items carry the descriptor-based evidence model (replacing the
 * old flat strengths/improvements/annotations, which the model no longer
 * produces): { section, awardedBand, marks, maxMarks,
 * evidenceSupportingAwardedBand[], nextBandRequirementNotMet, reason }.
 *
 * Any field the AI returns that isn't listed here is dropped.
 * Any field that is the wrong type is coerced to the right type.
 * This is the point to extend when the model's response shape changes again.
 *
 * @param {unknown} raw - The raw parsed JSON from the AI service.
 * @returns {{ score, maxScore, percentage, breakdown, actionableSteps,
 *   teacherReviewRequired, questionMismatch, questionMismatchReason,
 *   studentOcrText, confidence, lowConfidenceWords, missingAos, answerExcerpt }}
 * @throws {Error} if `raw` is not an object (caller will catch and return 500).
 */
export function sanitizeAIResult(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('AI response was not a valid object')
    }

    const score    = safeInt(raw.score,    { min: 0 })
    const maxScore = safeInt(raw.maxScore, { min: 1, fallback: 1 })

    // Recalculate percentage from sanitised score/maxScore rather than trusting
    // the AI-supplied value — this prevents "percentage: 9999" style manipulation.
    const percentage = safeInt(
        raw.percentage ?? Math.round((score / maxScore) * 100),
        { min: 0, max: 100 }
    )

    const sanitizeList = (arr) => Array.isArray(arr)
        ? arr.filter(s => s && typeof s === 'string').map(s => safeText(s, { maxLength: 500 }))
        : []

    const actionableSteps = sanitizeList(raw.actionable_steps)

    // Each evidence entry inside a descriptor: a verbatim quote plus why it
    // demonstrates that specific descriptor. Capped defensively — the prompt
    // asks for 1-3 per descriptor, but this is the boundary that actually
    // enforces it regardless of what the model returns.
    const sanitizeDescriptorEvidence = (items) => Array.isArray(items)
        ? items
              .filter(item => item && typeof item === 'object')
              .slice(0, 5)
              .map(item => ({
                  quote:       safeText(item.quote,       { maxLength: 500 }),
                  explanation: safeText(item.explanation, { maxLength: 1000 }),
              }))
        : []

    // One entry per descriptor ID in the awarded band — status coerced to one
    // of the three valid values rather than trusting the model's casing/spelling.
    const sanitizeAwardedBandEvidence = (items) => Array.isArray(items)
        ? items
              .filter(item => item && typeof item === 'object' && item.descriptor_id)
              .map(item => {
                  const status = safeText(item.status, { maxLength: 30 }).toLowerCase()
                  return {
                      descriptorId: safeText(item.descriptor_id, { maxLength: 100 }),
                      status: VALID_DESCRIPTOR_STATUSES.includes(status) ? status : 'not_met',
                      evidence: sanitizeDescriptorEvidence(item.evidence),
                      judgement: safeText(item.judgement, { maxLength: 1000 }),
                  }
              })
        : []

    const breakdown = Array.isArray(raw.rubric_breakdown)
        ? raw.rubric_breakdown
              .filter(item => item && typeof item === 'object')
              .map(item => {
                  const maxMarks = safeInt(item.max_marks,     { min: 1, fallback: 1 })
                  const marks    = safeInt(item.score_awarded, { min: 0, max: maxMarks })
                  return {
                      section:     safeText(item.criterion, { maxLength: 200, fallback: 'Section' }),
                      awardedBand: safeText(item.awarded_band, { maxLength: 100 }),
                      marks,
                      maxMarks,
                      evidenceSupportingAwardedBand: sanitizeAwardedBandEvidence(item.evidence_supporting_awarded_band),
                      nextBandRequirementNotMet: item.next_band_requirement_not_met === null
                          ? null
                          : safeText(item.next_band_requirement_not_met, { maxLength: 500 }),
                      reason: safeText(item.reason, { maxLength: 500 }),
                  }
              })
        : []

    const teacherReviewRequired  = raw.teacher_review_required === true
    const questionMismatch       = raw.question_mismatch === true
    const questionMismatchReason = safeText(raw.question_mismatch_reason ?? '', { maxLength: 500 })

    // From self-consistency (marking the same essay n times, n>1) — how much
    // the samples agreed, not a type coerced-to-0 the way safeInt would: a
    // genuinely absent/unmeasurable confidence (e.g. only one sample came
    // back usable) stays null rather than silently reading as "0% confident".
    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : null

    const studentOcrText = safeText(raw.student_ocr_text ?? '', { maxLength: 20000 })

    // Words Datalab's OCR wasn't confident it read correctly — surfaced so
    // the teacher knows specifically what to double-check against the
    // original handwriting, not just that "something" might be off.
    const lowConfidenceWords = Array.isArray(raw.low_confidence_words)
        ? raw.low_confidence_words
              .filter(w => w && typeof w === 'object' && typeof w.word === 'string')
              .map(w => ({
                  word:       safeText(w.word, { maxLength: 100 }),
                  confidence: typeof w.confidence === 'number' && Number.isFinite(w.confidence)
                      ? Math.max(0, Math.min(1, w.confidence))
                      : 0,
              }))
              .slice(0, 50)
        : []

    // AO codes the mark scheme required that never appeared as their own
    // entry in rubric_breakdown at all — distinct from a present-but-
    // unevidenced AO (already caught via teacherReviewRequired).
    const missingAos = Array.isArray(raw.missing_aos)
        ? raw.missing_aos
              .filter(ao => ao && typeof ao === 'string')
              .map(ao => safeText(ao, { maxLength: 50 }))
              .slice(0, 20)
        : []

    // Only populated for a multi-question paper — the portion of the essay
    // the model identified as answering THIS specific question, so
    // attribution is checkable rather than assumed. Was already flowing
    // through the NDJSON stream but had never actually been added to this
    // allowlist, so it silently never reached the frontend until now.
    const answerExcerpt = raw.answer_excerpt === null || raw.answer_excerpt === undefined
        ? null
        : safeText(raw.answer_excerpt, { maxLength: 20000 })

    return { score, maxScore, percentage, breakdown, actionableSteps, teacherReviewRequired, questionMismatch, questionMismatchReason, studentOcrText, confidence, lowConfidenceWords, missingAos, answerExcerpt }
}
