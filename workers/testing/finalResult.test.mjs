import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeAIResult } from '../utils/sanitize.js'
import { feedbackResult } from '../../frontend/src/utils/feedbackResult.js'

const final = () => ({ status: 'complete', result: {
    score: 2, max_score: 6, original_max_score: 6, max_score_delta: 0,
    summary: 'Final teacher summary.',
    original_score: 2, delta: 0,
    breakdown: [{ section: 'AO4', awarded_band: 'Level 1', marks: 2, max_marks: 6, summary: 'Limited development.' }],
    evidence: Array.from({ length: 12 }, (_, index) => ({
        evidence_id: `e${index + 1}`, descriptor_ids: ['ao4-thread-a'],
        quote: '  The verb "quiet" suggests ~~that the~~ fear.  ',
        explanation: 'Final explanation.', summary: 'Final short summary.',
    })),
    featured_evidence_by_thread: [
        { thread_id: 'ao4-thread-a', evidence_ids: ['e3', 'e8'] },
    ],
} })

test('new result survives sanitisation independently of the old grade and drives feedback', () => {
    const raw = { score: 5, maxScore: 6, student_ocr_text: 'Stored OCR', final_result: final() }
    const { finalResult, ...holistic } = sanitizeAIResult(raw)
    assert.equal(holistic.score, 5)
    assert.equal(finalResult.result.score, 2)
    assert.equal(finalResult.result.originalScore, 2)
    assert.equal(finalResult.result.delta, 0)
    assert.equal(finalResult.result.originalMaxScore, 6)
    assert.equal(finalResult.result.maxScoreDelta, 0)
    assert.equal(finalResult.result.breakdown[0].awardedBand, 'Level 1')
    assert.equal(finalResult.result.evidence.length, 12)
    assert.equal(finalResult.result.evidence[0].quote, raw.final_result.result.evidence[0].quote)
    assert.deepEqual(finalResult.result.evidence[0].descriptorIds, ['ao4-thread-a'])
    assert.deepEqual(finalResult.result.featuredEvidenceByThread, {
        'ao4-thread-a': ['e3', 'e8'],
    })
    assert.equal(finalResult.result.evidence[0].summary, 'Final short summary.')
    const view = feedbackResult({ result: holistic, finalResult })
    assert.equal(view.result.score, 2)
    assert.equal(view.evidenceResult.evidence[0].explanation, 'Final explanation.')
    assert.equal(view.studentText, 'Stored OCR')
})

test('legacy and failed results fall back explicitly; empty final evidence never mixes in old evidence', () => {
    const row = { result: { score: 5 }, aggregation: { status: 'complete', result: { evidence: ['old'] } } }
    assert.equal(feedbackResult(row).result.score, 5)
    const failed = feedbackResult({ ...row, finalResult: { status: 'failed' } })
    assert.equal(failed.result.score, 5)
    assert.equal(failed.finalUnavailable, true)
    const current = feedbackResult({ ...row, finalResult: { status: 'complete', result: { score: 0, evidence: [] } } })
    assert.equal(current.result.score, 0)
    assert.deepEqual(current.evidenceResult.evidence, [])
})

test('failed validation retains diagnostic model output without driving feedback', () => {
    const diagnostic = final().result
    diagnostic.evidence[0].descriptor_ids = ['ao4-1a']
    const failed = sanitizeAIResult({
        final_result: {
            status: 'failed',
            reason: 'Final evidence descriptor does not belong to its supplied threads',
            model_result: diagnostic,
        },
    }).finalResult
    assert.equal(failed.status, 'failed')
    assert.equal(failed.modelResult.score, 2)
    assert.equal(failed.modelResult.originalScore, 2)
    assert.equal(failed.modelResult.delta, 0)
    assert.equal(failed.modelResult.originalMaxScore, 6)
    assert.equal(failed.modelResult.maxScoreDelta, 0)
    assert.deepEqual(failed.modelResult.evidence[0].descriptorIds, ['ao4-1a'])
    assert.deepEqual(failed.modelResult.featuredEvidenceByThread, {
        'ao4-thread-a': ['e3', 'e8'],
    })

    const view = feedbackResult({ result: { score: 5 }, finalResult: failed })
    assert.equal(view.result.score, 5)
    assert.equal(view.evidenceResult, null)
    assert.equal(view.finalUnavailable, true)
})

test('inconsistent marks are rejected if they were not reconciled before sanitisation', () => {
    const invalid = final()
    invalid.result.score = 4
    assert.equal(sanitizeAIResult({ final_result: invalid }).finalResult.status, 'failed')
})

test('a reconciled score and its original value survive sanitisation', () => {
    const raw = final()
    raw.result.score = 3
    raw.result.breakdown[0].marks = 3
    raw.result.original_score = 2
    raw.result.delta = 1
    const clean = sanitizeAIResult({ final_result: raw }).finalResult
    assert.equal(clean.result.score, 3)
    assert.equal(clean.result.originalScore, 2)
    assert.equal(clean.result.delta, 1)
})

test('a reconciled maximum and its original value survive sanitisation', () => {
    const raw = final()
    raw.result.original_max_score = 12
    raw.result.max_score_delta = -6

    const clean = sanitizeAIResult({ final_result: raw }).finalResult

    assert.equal(clean.status, 'complete')
    assert.equal(clean.result.maxScore, 6)
    assert.equal(clean.result.originalMaxScore, 12)
    assert.equal(clean.result.maxScoreDelta, -6)
})

test('inconsistent maximum delta is rejected', () => {
    const raw = final()
    raw.result.original_max_score = 12

    assert.equal(sanitizeAIResult({ final_result: raw }).finalResult.status, 'failed')
})

test('featured nominations are deduplicated, limited, and checked against final thread assignments', () => {
    const raw = final()
    raw.result.evidence[2].descriptor_ids = ['ao4-thread-a', 'ao4-thread-b']
    raw.result.featured_evidence_by_thread = [
        { thread_id: 'ao4-thread-a', evidence_ids: ['e3', 'e3', 'e8', 'e9'] },
        { thread_id: 'ao4-thread-a', evidence_ids: ['e10'] },
        { thread_id: 'ao4-thread-b', evidence_ids: ['e1', 'unknown', 'e3'] },
        { thread_id: 'ao4-thread-c', evidence_ids: ['e1'] },
    ]

    const clean = sanitizeAIResult({ final_result: raw }).finalResult

    assert.equal(clean.status, 'complete')
    assert.deepEqual(clean.result.featuredEvidenceByThread, {
        'ao4-thread-a': ['e3', 'e8'],
        'ao4-thread-b': ['e3'],
    })
})

test('legacy final results without nominations still have an empty featured map', () => {
    const raw = final()
    delete raw.result.featured_evidence_by_thread

    const clean = sanitizeAIResult({ final_result: raw }).finalResult

    assert.equal(clean.status, 'complete')
    assert.deepEqual(clean.result.featuredEvidenceByThread, {})
})

test('final sanitiser excludes extra fields, including earlier segmentation output', () => {
    const raw = final()
    raw.result.unwanted = 'discard'
    raw.result.evidence[0].unwanted = 'discard'
    const clean = sanitizeAIResult({ final_result: raw, segmentation: { status: 'complete' } })
    assert.ok(!('segmentation' in clean))
    assert.ok(!('unwanted' in clean.finalResult.result))
    assert.ok(!('unwanted' in clean.finalResult.result.evidence[0]))
})

test('aggregation sanitiser preserves all evidence and descriptors without explanations', () => {
    const descriptorIds = Array.from({ length: 25 }, (_, index) => `ao4-${index + 1}a`)
    const evidence = Array.from({ length: 12 }, (_, index) => ({
        quote: ` Evidence ${index + 1}. `,
        descriptor_ids: descriptorIds,
        explanation: 'Obsolete aggregation explanation.',
        unwanted: 'discard',
    }))

    const clean = sanitizeAIResult({
        aggregation: { status: 'complete', result: { evidence } },
    }).aggregation

    assert.equal(clean.status, 'complete')
    assert.equal(clean.result.evidence.length, 12)
    assert.deepEqual(clean.result.evidence[0], {
        quote: 'Evidence 1.',
        descriptor_ids: descriptorIds,
    })
    assert.equal(clean.result.evidence[11].quote, 'Evidence 12.')
})
