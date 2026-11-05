// Teacher review logic, kept free of database and HTTP so it can be tested
// directly (backend/testing/review.test.mjs). Routes: routes/review.js.
import { randomInt } from 'crypto'
import { teacherText } from './teacherFacing.js'

export const REASON_CODES = ['too_generous', 'too_harsh', 'missed_evidence', 'misread_question', 'other']
export const MAX_SECONDS_SPENT = 2 * 60 * 60

export class ReviewInputError extends Error {}

const parseJson = text => {
    if (!text) return null
    try { return JSON.parse(text) } catch { return null }
}

const levelFromBand = band => {
    const match = typeof band === 'string' ? band.match(/\d+/) : null
    return match ? Number(match[0]) : null
}

// The selected question's thread extraction, resolved the same way the worker
// does (workers/markingWorker.js): structured_scheme picks the question,
// thread_extraction holds its levels.
export function selectedQuestionExtraction(ocrRow) {
    const structured = parseJson(ocrRow?.structured_scheme)
    const threads = parseJson(ocrRow?.thread_extraction)
    const questions = structured?.questions
    if (!Array.isArray(questions) || questions.length === 0 || !threads?.questions) return null
    const question = questions[ocrRow.selected_question_index ?? 0] ?? questions[0]
    return threads.questions[question?.question_number] ?? null
}

// Level choices for the review picker. Single-AO, level-based questions only
// -- the same questions the specialist engine marks; anything else returns
// null and the review screen isn't offered.
// A band is a level only if it is labelled like one ("Level 3", "Band 2",
// or a bare number such as a "0" band) -- a points question's "1 mark"
// band is not.
const LEVEL_LABEL = /^\s*(?:(?:level|band)\s*)?(\d+)\s*$/i

export function levelsFor(questionExtraction) {
    const aos = Object.values(questionExtraction?.assessment_objectives ?? {})
    if (aos.length !== 1 || !Array.isArray(aos[0].band_marks)) return null
    const levels = []
    for (const band of aos[0].band_marks) {
        const label = typeof band.band === 'string' ? band.band.match(LEVEL_LABEL) : null
        const numbers = String(band.marks ?? '').match(/\d+/g)?.map(Number)
        if (!label || !numbers?.length) return null
        levels.push({ level: Number(label[1]), min: Math.min(...numbers), max: Math.max(...numbers) })
    }
    if (levels.filter(item => item.max > 0).length < 2) return null
    // Teachers must be able to give no credit (a blank or off-task answer)
    // even when the scheme has no 0-mark band.
    if (!levels.some(item => item.min === 0)) levels.push({ level: 0, min: 0, max: 0 })
    return levels.sort((a, b) => a.level - b.level)
}

// What the engine gave this essay. Prefers the specialist engine's block;
// falls back to the final mark, then the holistic mark, for older results.
export function engineSnapshot(row) {
    const grade = parseJson(row.student_grade) ?? {}
    const final = parseJson(row.final_result)
    const result = final?.status === 'complete' ? final.result : null
    const engine = result?.engine ?? null
    const source = result ?? grade
    const evidenceQuotes = [...new Set((result?.evidence ?? [])
        .map(item => typeof item.quote === 'string' ? item.quote.trim() : '')
        .filter(Boolean))]
    return {
        level: engine?.level ?? levelFromBand(source.breakdown?.[0]?.awardedBand),
        mark: engine?.mark ?? source.score,
        maxMark: engine?.maxMark ?? source.maxScore,
        borderline: engine?.borderline ?? false,
        borderlineLevels: engine?.borderlineLevels ?? null,
        threads: engine?.threads ?? [],
        evidenceQuotes,
        essayText: typeof grade.studentOcrText === 'string' ? grade.studentOcrText : '',
        markedAt: row.marked_at,
        // Internal -- stored with the review for calibration, never returned.
        fineScore: engine?.fineScore ?? null,
        schemeKey: engine?.schemeKey ?? null,
        combineMode: engine?.combineMode ?? null,
        runsPerThread: engine?.runsPerThread ?? null,
    }
}

export function parseReviewInput(body, levels) {
    const teacherLevel = body?.teacherLevel
    const band = levels.find(item => item.level === teacherLevel)
    if (!Number.isInteger(teacherLevel) || !band) throw new ReviewInputError('Choose a level')

    let teacherMark = body.teacherMark ?? null
    if (teacherMark !== null && (!Number.isInteger(teacherMark) || teacherMark < band.min || teacherMark > band.max)) {
        throw new ReviewInputError(`The mark must be between ${band.min} and ${band.max} for Level ${band.level}`)
    }

    const rawReasons = body.reasonCodes ?? []
    if (!Array.isArray(rawReasons) || rawReasons.length > REASON_CODES.length
        || rawReasons.some(code => !REASON_CODES.includes(code))) {
        throw new ReviewInputError('Unknown reason')
    }

    const seconds = body.secondsSpent
    const secondsSpent = Number.isInteger(seconds) && seconds >= 0 ? Math.min(seconds, MAX_SECONDS_SPENT) : null
    return { teacherLevel, teacherMark, reasonCodes: [...new Set(rawReasons)], secondsSpent }
}

// Confirmed only if the teacher kept the engine's level and either left the
// mark alone or chose the same mark.
export function outcomeFor(engine, input) {
    const sameLevel = input.teacherLevel === engine.level
    const sameMark = input.teacherMark === null || input.teacherMark === engine.mark
    return sameLevel && sameMark ? 'confirmed' : 'changed'
}

// 2-3 blind checks per class, once there are enough essays to pick from.
export function blindPickCount(markedCount) {
    if (markedCount < 5) return 0
    return markedCount >= 10 ? 3 : 2
}

export function chooseBlind(studentIds, pickInt = randomInt) {
    const pool = [...studentIds]
    const picked = []
    for (let n = blindPickCount(pool.length); n > 0; n--) {
        picked.push(pool.splice(pickInt(pool.length), 1)[0])
    }
    return picked
}

// Why an essay needs the teacher's check, most important first. Empty once
// the teacher has reviewed it. Counted on the Feedback and marking pages.
export function checkReasons(row) {
    if (row.review_id) return []
    const grade = parseJson(row.student_grade) ?? {}
    const final = parseJson(row.final_result)
    const result = final?.status === 'complete' ? final.result : null
    const reasons = []
    if (grade.questionMismatch) reasons.push('wrong_question')
    if (row.blind_pick) reasons.push('blind_check')
    if (result?.engine?.borderline) reasons.push('borderline')
    if (grade.teacherReviewRequired || result?.teacherReviewRequired) reasons.push('review_required')
    return reasons
}

// { count, byStudent: { [studentId]: reasons } } for a lesson's rows.
export function checkSummary(rows) {
    const byStudent = {}
    for (const row of rows) {
        const reasons = checkReasons(row)
        if (reasons.length) byStudent[row.student_id] = reasons
    }
    return { count: Object.keys(byStudent).length, byStudent }
}

// The model's note when the essay seems to answer a different question,
// cleaned like all teacher-facing text; null when there is no mismatch.
function wrongQuestion(row) {
    const grade = parseJson(row.student_grade) ?? {}
    if (!grade.questionMismatch) return null
    return { reason: teacherText(grade.questionMismatchReason) || null }
}

// { [studentId]: reason } for every essay that seems to answer a different
// question, reviewed or not -- the Feedback page shows the warning on the card.
export function wrongQuestionNotes(rows) {
    const notes = {}
    for (const row of rows) {
        const note = wrongQuestion(row)
        if (note) notes[row.student_id] = note.reason
    }
    return notes
}

export function reviewStatus(row) {
    if (row.review_id) return row.outcome
    if (row.blind_pick) return 'blind_check'
    const reasons = checkReasons(row)
    return reasons.includes('borderline') || reasons.includes('review_required') ? 'needs_checking' : 'not_reviewed'
}

const review = row => row.review_id ? {
    mode: row.review_mode,
    outcome: row.outcome,
    teacherLevel: row.teacher_level,
    teacherMark: row.teacher_mark,
    reasonCodes: row.reason_codes ? row.reason_codes.split(',') : [],
    reviewedAt: row.reviewed_at,
} : null

// The suggestion is hidden on a blind check until the teacher has chosen.
const hidesSuggestion = row => Boolean(row.blind_pick) && !row.review_id

const suggestion = engine => ({
    level: engine.level,
    mark: engine.mark,
    maxMark: engine.maxMark,
    borderline: engine.borderline,
    borderlineLevels: engine.borderlineLevels,
    threads: engine.threads,
    evidenceQuotes: engine.evidenceQuotes,
})

export function publicListItem(row) {
    const engine = engineSnapshot(row)
    const hidden = hidesSuggestion(row)
    return {
        studentId: row.student_id,
        studentName: row.student_name,
        status: reviewStatus(row),
        wrongQuestion: Boolean(wrongQuestion(row)),
        maxMark: engine.maxMark,
        level: hidden ? null : engine.level,
        mark: hidden ? null : engine.mark,
        borderline: hidden ? false : engine.borderline,
        review: review(row),
    }
}

export function publicEssay(row, levels) {
    const engine = engineSnapshot(row)
    return {
        studentId: row.student_id,
        studentName: row.student_name,
        essayText: engine.essayText,
        blind: Boolean(row.blind_pick),
        levels,
        // Shown even on a blind check: it is about the question, not the mark.
        wrongQuestion: wrongQuestion(row),
        flaggedForCheck: !hidesSuggestion(row) && checkReasons(row).includes('review_required'),
        suggestion: hidesSuggestion(row) ? null : suggestion(engine),
        review: review(row),
    }
}
