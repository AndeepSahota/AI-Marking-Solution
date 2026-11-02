import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_SECONDS_SPENT,
    ReviewInputError,
    blindPickCount,
    chooseBlind,
    engineSnapshot,
    levelsFor,
    outcomeFor,
    parseReviewInput,
    publicEssay,
    publicListItem,
    reviewStatus,
    selectedQuestionExtraction,
    stripEngineInternals,
} from '../src/services/reviewService.js'

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

test('levelsFor reads single-AO levels in order, with en dashes', () => {
    assert.deepEqual(levelsFor(extraction), LEVELS)
})

test('levelsFor refuses multi-AO and unparseable schemes', () => {
    assert.equal(levelsFor({ assessment_objectives: { AO1: extraction.assessment_objectives.AO4, AO2: extraction.assessment_objectives.AO4 } }), null)
    assert.equal(levelsFor({ assessment_objectives: { AO4: { band_marks: [{ band: 'Top', marks: '7-9' }] } } }), null)
    assert.equal(levelsFor(null), null)
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

test('reviewStatus', () => {
    const engine = { borderline: true }
    assert.equal(reviewStatus({ review_id: 1, outcome: 'changed' }, engine), 'changed')
    assert.equal(reviewStatus({ blind_pick: 1 }, engine), 'blind_check')
    assert.equal(reviewStatus({}, engine), 'needs_checking')
    assert.equal(reviewStatus({}, { borderline: false }), 'not_reviewed')
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
