import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_SECONDS_SPENT,
    ReviewInputError,
    blindPickCount,
    checkReasons,
    checkSummary,
    chooseBlind,
    engineSnapshot,
    levelsFor,
    outcomeFor,
    parseReviewInput,
    publicEssay,
    publicListItem,
    reviewStatus,
    selectedQuestionExtraction,
    wrongQuestionNotes,
} from '../src/services/reviewService.js'
import { stripEngineInternals } from '../src/services/teacherFacing.js'

const LEVELS = [
    { level: 1, min: 1, max: 3 },
    { level: 2, min: 4, max: 6 },
    { level: 3, min: 7, max: 9 },
]

const extraction = {
    assessment_objectives: {
        AO4: {
            band_marks: [
                { band: 'Level 3', marks: '7-9' },
                { band: 'Level 1', marks: '1-3' },
                { band: 'Level 2', marks: '4–6' },
            ],
        },
    },
}

const engineBlock = {
    level: 2, mark: 5, maxMark: 9,
    combineMode: 'calibrated', runsPerThread: 6, fineScore: 2.31,
    schemeKey: '0123456789abcdef',
    borderline: true, borderlineLevels: [2, 3],
    threads: [{ label: 'Judgement', reason: 'Evidence found for this skill.' }],
}

const row = (overrides = {}) => ({
    result_id: 10,
    student_id: 7,
    student_name: 'Test Student',
    marked_at: '2026-11-01 10:00:00',
    // Made-up text, not a real student's essay.
    student_grade: JSON.stringify({ studentOcrText: 'The writer is clear.', score: 4, maxScore: 9 }),
    final_result: JSON.stringify({
        status: 'complete',
        result: {
            score: 5, maxScore: 9, engine: engineBlock,
            evidence: [{ quote: ' is clear ' }, { quote: 'is clear' }, { quote: '' }],
        },
    }),
    review_id: null,
    blind_pick: 0,
    ...overrides,
})

const bands = (...pairs) => ({ assessment_objectives: { AO4: { band_marks: pairs.map(([band, marks]) => ({ band, marks })) } } })
const NO_CREDIT = { level: 0, min: 0, max: 0 }

test('levelsFor reads single-AO levels in order, with en dashes, adding No credit', () => {
    assert.deepEqual(levelsFor(extraction), [NO_CREDIT, ...LEVELS])
})

test('levelsFor keeps a scheme\'s own 0 band rather than adding another', () => {
    for (const zero of ['0', 'Level 0']) {
        assert.deepEqual(levelsFor(bands([zero, '0'], ['Level 1', '1-3'], ['Level 2', '4-6'])), [NO_CREDIT, { level: 1, min: 1, max: 3 }, { level: 2, min: 4, max: 6 }])
    }
    assert.deepEqual(levelsFor(bands(['Band 1', '1-6'], ['Band 2', '7-12'])).map(l => l.level), [0, 1, 2])
})

test('levelsFor refuses multi-AO, points-based and unparseable schemes', () => {
    assert.equal(levelsFor({ assessment_objectives: { AO1: extraction.assessment_objectives.AO4, AO2: extraction.assessment_objectives.AO4 } }), null)
    assert.equal(levelsFor(bands(['Top', '7-9'], ['Level 1', '1-3'])), null)
    // A points question (e.g. Paper 1 Q1) is not levelled, though "1 mark" has a digit.
    assert.equal(levelsFor({ assessment_objectives: { General: { band_marks: [{ band: '1 mark', marks: '1' }] } } }), null)
    assert.equal(levelsFor(bands(['Level 1', '1-4'])), null, 'one level is not a level scale')
    assert.equal(levelsFor(null), null)
})

test('No credit can be chosen and needs no mark', () => {
    const levels = levelsFor(extraction)
    assert.deepEqual(parseReviewInput({ teacherLevel: 0 }, levels), { teacherLevel: 0, teacherMark: null, reasonCodes: [], secondsSpent: null })
    assert.equal(parseReviewInput({ teacherLevel: 0, teacherMark: 0 }, levels).teacherMark, 0)
    assert.throws(() => parseReviewInput({ teacherLevel: 0, teacherMark: 1 }, levels), ReviewInputError)
})

test('selectedQuestionExtraction follows the selected question', () => {
    const ocrRow = {
        structured_scheme: JSON.stringify({ questions: [{ question_number: '2' }, { question_number: '4' }] }),
        thread_extraction: JSON.stringify({ questions: { 2: 'q2', 4: 'q4' } }),
        selected_question_index: 1,
    }
    assert.equal(selectedQuestionExtraction(ocrRow), 'q4')
    assert.equal(selectedQuestionExtraction({ ...ocrRow, structured_scheme: 'not json' }), null)
})

test('engineSnapshot prefers the engine block and de-duplicates quotes', () => {
    const snap = engineSnapshot(row())
    assert.equal(snap.level, 2)
    assert.equal(snap.mark, 5)
    assert.deepEqual(snap.evidenceQuotes, ['is clear'])
    assert.equal(snap.fineScore, 2.31)
})

test('engineSnapshot falls back to the holistic mark for old results', () => {
    const snap = engineSnapshot(row({
        final_result: null,
        student_grade: JSON.stringify({ score: 4, maxScore: 9, breakdown: [{ awardedBand: 'Level 2' }] }),
    }))
    assert.equal(snap.level, 2)
    assert.equal(snap.mark, 4)
    assert.equal(snap.borderline, false)
    assert.equal(snap.fineScore, null)
})

test('parseReviewInput accepts a level alone and a mark inside the band', () => {
    assert.deepEqual(parseReviewInput({ teacherLevel: 2 }, LEVELS),
        { teacherLevel: 2, teacherMark: null, reasonCodes: [], secondsSpent: null })
    const input = parseReviewInput({ teacherLevel: 3, teacherMark: 8, reasonCodes: ['too_harsh', 'too_harsh'], secondsSpent: 99999 }, LEVELS)
    assert.deepEqual(input.reasonCodes, ['too_harsh'])
    assert.equal(input.secondsSpent, MAX_SECONDS_SPENT)
})

test('parseReviewInput rejects bad input', () => {
    for (const body of [
        {},
        { teacherLevel: 4 },
        { teacherLevel: '2' },
        { teacherLevel: 2, teacherMark: 7 },
        { teacherLevel: 2, teacherMark: 4.5 },
        { teacherLevel: 2, reasonCodes: ['made_up'] },
        { teacherLevel: 2, reasonCodes: 'too_harsh' },
    ]) {
        assert.throws(() => parseReviewInput(body, LEVELS), ReviewInputError, JSON.stringify(body))
    }
})

test('outcomeFor: same level and no or same mark is confirmed', () => {
    const engine = { level: 2, mark: 5 }
    assert.equal(outcomeFor(engine, { teacherLevel: 2, teacherMark: null }), 'confirmed')
    assert.equal(outcomeFor(engine, { teacherLevel: 2, teacherMark: 5 }), 'confirmed')
    assert.equal(outcomeFor(engine, { teacherLevel: 2, teacherMark: 6 }), 'changed')
    assert.equal(outcomeFor(engine, { teacherLevel: 3, teacherMark: null }), 'changed')
})

test('blind checks: none under 5 essays, 2 under 10, then 3', () => {
    assert.equal(blindPickCount(4), 0)
    assert.equal(blindPickCount(5), 2)
    assert.equal(blindPickCount(9), 2)
    assert.equal(blindPickCount(30), 3)
    const picked = chooseBlind([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], () => 0)
    assert.deepEqual(picked, [1, 2, 3])
    assert.deepEqual(chooseBlind([1, 2, 3]), [])
})

// A row whose final result has these engine/top-level fields.
const rowWith = ({ borderline = false, reviewRequired = false, mismatch = null, ...rest } = {}) => row({
    student_grade: JSON.stringify({
        score: 4, maxScore: 9,
        ...(mismatch !== null && { questionMismatch: true, questionMismatchReason: mismatch }),
    }),
    final_result: JSON.stringify({
        status: 'complete',
        result: { score: 5, maxScore: 9, teacherReviewRequired: reviewRequired, engine: { ...engineBlock, borderline } },
    }),
    ...rest,
})

test('reviewStatus', () => {
    assert.equal(reviewStatus(rowWith({ borderline: true, review_id: 1, outcome: 'changed' })), 'changed')
    assert.equal(reviewStatus(rowWith({ borderline: true, blind_pick: 1 })), 'blind_check')
    assert.equal(reviewStatus(rowWith({ borderline: true })), 'needs_checking')
    assert.equal(reviewStatus(rowWith({ reviewRequired: true })), 'needs_checking')
    assert.equal(reviewStatus(rowWith()), 'not_reviewed')
})

test('checkReasons lists why an unreviewed essay needs a check, most important first', () => {
    assert.deepEqual(
        checkReasons(rowWith({ borderline: true, reviewRequired: true, mismatch: 'Wrong task.', blind_pick: 1 })),
        ['wrong_question', 'blind_check', 'borderline', 'review_required']
    )
    assert.deepEqual(checkReasons(rowWith()), [])
    assert.deepEqual(checkReasons(rowWith({ borderline: true, review_id: 3 })), [], 'reviewed essays are done')
})

test('checkSummary counts each essay once', () => {
    const summary = checkSummary([
        rowWith({ student_id: 1, borderline: true, reviewRequired: true }),
        rowWith({ student_id: 2 }),
        rowWith({ student_id: 3, mismatch: 'Wrong task.' }),
    ])
    assert.equal(summary.count, 2)
    assert.deepEqual(Object.keys(summary.byStudent), ['1', '3'])
})

test('the wrong-question note is cleaned and shown even on a blind check', () => {
    const essay = publicEssay(rowWith({ blind_pick: 1, mismatch: 'Answers a different task. This fits Level 2.' }), LEVELS)
    assert.deepEqual(essay.wrongQuestion, { reason: 'Answers a different task.' })
    assert.equal(essay.suggestion, null)
    assert.equal(publicEssay(rowWith(), LEVELS).wrongQuestion, null)
    assert.equal(publicListItem(rowWith({ mismatch: '' })).wrongQuestion, true)
    assert.deepEqual(wrongQuestionNotes([rowWith({ student_id: 5, mismatch: 'Wrong task.' }), rowWith({ student_id: 6 })]), { 5: 'Wrong task.' })
})

test('flaggedForCheck shows a "teacher review required" essay once its suggestion is visible', () => {
    assert.equal(publicEssay(rowWith({ reviewRequired: true }), LEVELS).flaggedForCheck, true)
    assert.equal(publicEssay(rowWith({ reviewRequired: true, blind_pick: 1 }), LEVELS).flaggedForCheck, false)
})

const INTERNALS = ['fineScore', 'schemeKey', 'combineMode', 'runsPerThread']

test('public views never include calibration internals', () => {
    const text = JSON.stringify([publicListItem(row()), publicEssay(row(), LEVELS)])
    for (const field of INTERNALS) assert.ok(!text.includes(field), field)
    assert.ok(!text.includes('0123456789abcdef'))
})

test('a blind check hides the suggestion until reviewed', () => {
    const pending = row({ blind_pick: 1 })
    assert.equal(publicEssay(pending, LEVELS).suggestion, null)
    const item = publicListItem(pending)
    assert.equal(item.level, null)
    assert.equal(item.mark, null)
    assert.equal(item.borderline, false)

    const reviewed = row({
        blind_pick: 1, review_id: 3, review_mode: 'blind', outcome: 'confirmed',
        teacher_level: 2, teacher_mark: null, reason_codes: null, reviewed_at: '2026-11-01 11:00:00',
    })
    assert.equal(publicEssay(reviewed, LEVELS).suggestion.level, 2)
    assert.equal(publicListItem(reviewed).review.mode, 'blind')
})

test('stripEngineInternals keeps teacher fields and leaves other results alone', () => {
    const final = JSON.parse(row().final_result)
    const stripped = stripEngineInternals(final)
    for (const field of INTERNALS) assert.equal(field in stripped.result.engine, false)
    assert.deepEqual(stripped.result.engine.borderlineLevels, [2, 3])
    assert.equal(final.result.engine.fineScore, 2.31, 'input not mutated')
    const failed = { status: 'failed' }
    assert.equal(stripEngineInternals(failed), failed)
})
