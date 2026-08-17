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

/**
 * Sanitize the full AI marking result.
 *
 * Enforces the exact schema expected by the frontend:
 *   { score, maxScore, percentage, breakdown[], feedback }
 *
 * Any field the AI returns that isn't listed here is dropped.
 * Any field that is the wrong type is coerced to the right type.
 * This is the point to extend when the real model adds new fields
 * (e.g. ocrText, criteriaDetails, etc.).
 *
 * @param {unknown} raw - The raw parsed JSON from the AI service.
 * @returns {{ score, maxScore, percentage, breakdown, feedback }}
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

    const strengths      = sanitizeList(raw.strengths)
    const improvements   = sanitizeList(raw.improvements)
    const actionableSteps = sanitizeList(raw.actionable_steps)

    const breakdown = Array.isArray(raw.rubric_breakdown)
        ? raw.rubric_breakdown
              .filter(item => item && typeof item === 'object')
              .map(item => {
                  const maxMarks = safeInt(item.max_marks,     { min: 1, fallback: 1 })
                  const marks    = safeInt(item.score_awarded, { min: 0, max: maxMarks })
                  return {
                      section:  safeText(item.criterion, { maxLength: 200, fallback: 'Section' }),
                      marks,
                      maxMarks,
                      reason:   safeText(item.reason,    { maxLength: 500 }),
                  }
              })
        : []

    const teacherReviewRequired  = raw.teacher_review_required === true
    const questionMismatch       = raw.question_mismatch === true
    const questionMismatchReason = safeText(raw.question_mismatch_reason ?? '', { maxLength: 500 })

    const studentOcrText = safeText(raw.student_ocr_text ?? '', { maxLength: 20000 })

    // Evidence is nested inside each AO's "evidence" array in the AI's response
    // (not a separate top-level field) — flatten it here, tagging each piece
    // with its parent AO so the frontend can label/group it.
    const annotations = Array.isArray(raw.rubric_breakdown)
        ? raw.rubric_breakdown
              .filter(item => item && typeof item === 'object' && Array.isArray(item.evidence))
              .flatMap(item => {
                  const ao = safeText(item.criterion, { maxLength: 50, fallback: '' })
                  return item.evidence
                      .filter(a => a && typeof a === 'object' && a.quote && a.comment)
                      .map(a => ({
                          ao,
                          quote:        safeText(a.quote,   { maxLength: 500 }),
                          comment:      safeText(a.comment, { maxLength: 1000 }),
                          type:         a.type === 'strength' ? 'strength' : 'improvement',
                          marksImpact:  safeInt(a.marks_impact, { min: 0, max: 100, fallback: 0 }),
                          howToImprove: safeText(a.how_to_improve ?? '', { maxLength: 300 }),
                      }))
              })
              .slice(0, 20)
        : []

    return { score, maxScore, percentage, breakdown, strengths, improvements, actionableSteps, teacherReviewRequired, questionMismatch, questionMismatchReason, studentOcrText, annotations }
}
