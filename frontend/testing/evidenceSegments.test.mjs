// Run with: node --test frontend/testing/evidenceSegments.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEvidenceSegments } from '../src/utils/evidenceSegments.js'

// Made-up text, not a real student's essay.
const TEXT = 'The sea was calm. The boat rocked slowly. The sea was calm again.'
const place = quotes => buildEvidenceSegments(TEXT, quotes.map((quote, i) => ({ id: `c${i}`, quote })))
const highlights = result => result.segments.filter(s => s.type === 'highlight')

test('the same sentence cited twice shares one highlight', () => {
    const result = place(['The boat rocked slowly.', 'The boat rocked slowly.'])
    assert.ok(result.cards.every(card => card.match))
    assert.deepEqual(highlights(result).map(h => h.cards.map(c => c.id)), [['c0', 'c1']])
})

test('a quote inside a longer one merges into the longer highlight', () => {
    const result = place(['The boat rocked slowly.', 'rocked'])
    assert.ok(result.cards.every(card => card.match))
    const [only] = highlights(result)
    assert.equal(only.content, 'The boat rocked slowly.')
    assert.equal(only.cards.length, 2)
})

test('partly overlapping quotes merge into their union', () => {
    const result = place(['calm. The boat', 'The boat rocked'])
    assert.deepEqual(highlights(result).map(h => h.content), ['calm. The boat rocked'])
})

test('a phrase the student wrote twice is highlighted in both places', () => {
    const result = place(['The sea was calm', 'The sea was calm'])
    assert.equal(highlights(result).length, 2)
})

test('a quote not in the essay is still reported as unmatched', () => {
    const result = place(['The storm raged.'])
    assert.equal(result.cards[0].match, null)
})

test('the essay text is never altered', () => {
    const result = place(['The boat rocked slowly.', 'rocked', 'calm. The boat', 'missing words'])
    assert.equal(result.segments.map(s => s.content).join(''), TEXT)
})
