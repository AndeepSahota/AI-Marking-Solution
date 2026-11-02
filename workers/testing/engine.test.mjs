import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeEngine } from '../utils/sanitizeFinalResult.js'

const engine = (overrides = {}) => ({
    level: 3, mark: 8, max_mark: 15,
    combine_mode: 'calibrated', runs_per_thread: 6, fine_score: 2.61,
    scheme_key: '9e3703bc1e37b448',
    borderline: true, borderline_levels: [3, 4],
    threads: [
        { label: 'Ideas, events, themes or settings', reason: 'Explains how the dark hides the threat.' },
        { label: 'Judgement about the text', reason: 'No clear evidence found for this skill.' },
    ],
    ...overrides,
})

test('a valid engine block is kept, in camelCase', () => {
    assert.deepEqual(sanitizeEngine(engine(), 15), {
        level: 3, mark: 8, maxMark: 15,
        combineMode: 'calibrated', runsPerThread: 6, fineScore: 2.61,
        schemeKey: '9e3703bc1e37b448',
        borderline: true, borderlineLevels: [3, 4],
        threads: [
            { label: 'Ideas, events, themes or settings', reason: 'Explains how the dark hides the threat.' },
            { label: 'Judgement about the text', reason: 'No clear evidence found for this skill.' },
        ],
    })
})

test('a missing engine block is simply null', () => {
    assert.equal(sanitizeEngine(undefined, 15), null)
})

test('optional internals may be absent', () => {
    const result = sanitizeEngine(engine({ fine_score: null, scheme_key: null, borderline: false, borderline_levels: null }), 15)
    assert.equal(result.fineScore, null)
    assert.equal(result.schemeKey, null)
    assert.equal(result.borderlineLevels, null)
})

test('anything malformed drops the whole block rather than storing it', () => {
    for (const bad of [
        { mark: 16 },                          // above the maximum
        { max_mark: 20 },                      // disagrees with the result's maximum
        { combine_mode: 'guess' },
        { fine_score: 'high' },
        { scheme_key: '<script>' },
        { borderline: 'yes' },
        { borderline_levels: [4, 3] },
        { borderline_levels: [3] },
        { threads: [{ label: 'Ideas', reason: '' }] },
        { threads: 'none' },
    ]) {
        assert.equal(sanitizeEngine(engine(bad), 15), null, JSON.stringify(bad))
    }
})

test('long thread text is cut to size', () => {
    const result = sanitizeEngine(engine({ threads: [{ label: 'x'.repeat(500), reason: 'y'.repeat(500) }] }), 15)
    assert.equal(result.threads[0].label.length, 100)
    assert.equal(result.threads[0].reason.length, 300)
})
