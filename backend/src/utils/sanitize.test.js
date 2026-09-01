import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeAIResult } from './sanitize.js'

describe('sanitizeAIResult — input validation', () => {
    it('throws when raw is null', () => {
        assert.throws(() => sanitizeAIResult(null))
    })

    it('throws when raw is undefined', () => {
        assert.throws(() => sanitizeAIResult(undefined))
    })

    it('throws when raw is a string', () => {
        assert.throws(() => sanitizeAIResult('not an object'))
    })

    it('throws when raw is an array', () => {
        assert.throws(() => sanitizeAIResult([]))
    })
})

describe('sanitizeAIResult — score/maxScore/percentage', () => {
    it('clamps a negative score to 0', () => {
        const result = sanitizeAIResult({ score: -5, maxScore: 10 })
        assert.equal(result.score, 0)
    })

    it('rounds a non-integer score', () => {
        const result = sanitizeAIResult({ score: 4.6, maxScore: 10 })
        assert.equal(result.score, 5)
    })

    it('falls back maxScore to 1 when missing', () => {
        const result = sanitizeAIResult({ score: 3 })
        assert.equal(result.maxScore, 1)
    })

    it('recalculates percentage from score/maxScore when absent', () => {
        const result = sanitizeAIResult({ score: 5, maxScore: 10 })
        assert.equal(result.percentage, 50)
    })

    it('clamps an absurd raw.percentage to 100 even when present', () => {
        const result = sanitizeAIResult({ score: 5, maxScore: 10, percentage: 9999 })
        assert.equal(result.percentage, 100)
    })
})

describe('sanitizeAIResult — breakdown', () => {
    it('maps a valid rubric_breakdown array correctly', () => {
        const result = sanitizeAIResult({
            rubric_breakdown: [
                { criterion: 'AO1', score_awarded: 5, max_marks: 8, reason: 'good' },
            ],
        })
        assert.deepEqual(result.breakdown, [
            { section: 'AO1', marks: 5, maxMarks: 8, reason: 'good' },
        ])
    })

    it('filters out non-object entries', () => {
        const result = sanitizeAIResult({ rubric_breakdown: [null, 'x', 42] })
        assert.deepEqual(result.breakdown, [])
    })

    it('clamps score_awarded to [0, max_marks]', () => {
        const result = sanitizeAIResult({
            rubric_breakdown: [{ criterion: 'AO1', score_awarded: 999, max_marks: 8 }],
        })
        assert.equal(result.breakdown[0].marks, 8)
    })

    it('falls back criterion to "Section" when missing', () => {
        const result = sanitizeAIResult({ rubric_breakdown: [{ score_awarded: 1, max_marks: 8 }] })
        assert.equal(result.breakdown[0].section, 'Section')
    })
})

describe('sanitizeAIResult — boolean flags', () => {
    it('only coerces literal true to true for teacherReviewRequired', () => {
        assert.equal(sanitizeAIResult({ teacher_review_required: true }).teacherReviewRequired, true)
        assert.equal(sanitizeAIResult({ teacher_review_required: 'true' }).teacherReviewRequired, false)
        assert.equal(sanitizeAIResult({ teacher_review_required: 1 }).teacherReviewRequired, false)
        assert.equal(sanitizeAIResult({ teacher_review_required: null }).teacherReviewRequired, false)
    })

    it('only coerces literal true to true for questionMismatch', () => {
        assert.equal(sanitizeAIResult({ question_mismatch: true }).questionMismatch, true)
        assert.equal(sanitizeAIResult({ question_mismatch: 'true' }).questionMismatch, false)
    })
})

describe('sanitizeAIResult — annotations', () => {
    it('flattens evidence nested inside rubric_breakdown items', () => {
        const result = sanitizeAIResult({
            rubric_breakdown: [{
                criterion: 'AO1',
                evidence: [{ quote: 'q', comment: 'c', type: 'strength', marks_impact: 2 }],
            }],
        })
        assert.deepEqual(result.annotations, [
            { ao: 'AO1', quote: 'q', comment: 'c', type: 'strength', marksImpact: 2, howToImprove: '' },
        ])
    })

    it('drops items where evidence is not an array', () => {
        const result = sanitizeAIResult({ rubric_breakdown: [{ criterion: 'AO1', evidence: 'not an array' }] })
        assert.deepEqual(result.annotations, [])
    })

    it('drops evidence entries missing a quote or comment', () => {
        const result = sanitizeAIResult({
            rubric_breakdown: [{ criterion: 'AO1', evidence: [{ quote: '', comment: 'c' }, { quote: 'q', comment: '' }] }],
        })
        assert.deepEqual(result.annotations, [])
    })

    it('caps annotations at 20', () => {
        const evidence = Array.from({ length: 25 }, (_, i) => ({ quote: `q${i}`, comment: `c${i}`, type: 'strength' }))
        const result = sanitizeAIResult({ rubric_breakdown: [{ criterion: 'AO1', evidence }] })
        assert.equal(result.annotations.length, 20)
    })
})

describe('sanitizeAIResult — lowConfidenceWords', () => {
    it('passes through valid entries', () => {
        const result = sanitizeAIResult({ low_confidence_words: [{ word: 'scrawled', confidence: 0.4 }] })
        assert.deepEqual(result.lowConfidenceWords, [{ word: 'scrawled', confidence: 0.4 }])
    })

    it('filters out non-object entries', () => {
        const result = sanitizeAIResult({ low_confidence_words: ['just a string', null] })
        assert.deepEqual(result.lowConfidenceWords, [])
    })

    it('falls back confidence to 0 when missing or non-numeric', () => {
        const result = sanitizeAIResult({ low_confidence_words: [{ word: 'x', confidence: 'high' }] })
        assert.equal(result.lowConfidenceWords[0].confidence, 0)
    })

    it('caps at 50', () => {
        const words = Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, confidence: 0.5 }))
        const result = sanitizeAIResult({ low_confidence_words: words })
        assert.equal(result.lowConfidenceWords.length, 50)
    })
})

describe('sanitizeAIResult — missingAos', () => {
    it('passes through valid string entries', () => {
        const result = sanitizeAIResult({ missing_aos: ['AO3'] })
        assert.deepEqual(result.missingAos, ['AO3'])
    })

    it('filters out non-string entries', () => {
        const result = sanitizeAIResult({ missing_aos: ['AO3', 42, null, {}] })
        assert.deepEqual(result.missingAos, ['AO3'])
    })

    it('caps at 20', () => {
        const aos = Array.from({ length: 25 }, (_, i) => `AO${i}`)
        const result = sanitizeAIResult({ missing_aos: aos })
        assert.equal(result.missingAos.length, 20)
    })
})

describe('sanitizeAIResult — happy path', () => {
    it('returns the full expected shape for a realistic complete response', () => {
        const raw = {
            score: 18, maxScore: 24, percentage: 75,
            strengths: ['Good use of evidence'],
            improvements: ['Needs more context'],
            actionable_steps: ['Add a contextual paragraph'],
            rubric_breakdown: [
                { criterion: 'AO1', score_awarded: 6, max_marks: 8, reason: 'r', evidence: [{ quote: 'q', comment: 'c', type: 'strength', marks_impact: 2 }] },
            ],
            teacher_review_required: false,
            question_mismatch: false,
            question_mismatch_reason: null,
            student_ocr_text: 'The essay text.',
            confidence: 0.9,
            low_confidence_words: [],
            missing_aos: [],
        }
        const result = sanitizeAIResult(raw)
        assert.equal(result.score, 18)
        assert.equal(result.maxScore, 24)
        assert.equal(result.percentage, 75)
        assert.deepEqual(result.strengths, ['Good use of evidence'])
        assert.deepEqual(result.improvements, ['Needs more context'])
        assert.deepEqual(result.actionableSteps, ['Add a contextual paragraph'])
        assert.equal(result.breakdown.length, 1)
        assert.equal(result.teacherReviewRequired, false)
        assert.equal(result.questionMismatch, false)
        assert.equal(result.studentOcrText, 'The essay text.')
        assert.equal(result.confidence, 0.9)
        assert.deepEqual(result.lowConfidenceWords, [])
        assert.deepEqual(result.missingAos, [])
        assert.equal(result.annotations.length, 1)
    })
})
