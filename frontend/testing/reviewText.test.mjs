// Run with: node --test frontend/testing/reviewText.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { couldBeText, levelName, markText, rangeText } from '../src/utils/reviewText.js'

test('could-be names the other side of the borderline pair', () => {
    assert.equal(couldBeText(3, [3, 4]), 'could be 4')
    assert.equal(couldBeText(3, [2, 3]), 'could be 2')
    assert.equal(couldBeText(3, [2, 4]), 'could be 2 or 4')
    assert.equal(couldBeText(2, [1, 4]), 'could be 1, 3 or 4')
})

test('no could-be without a borderline range', () => {
    assert.equal(couldBeText(3, null), null)
    assert.equal(couldBeText(null, [3, 4]), null)
    assert.equal(couldBeText(3, [3, 3]), null)
})

test('level and mark wording, with No credit', () => {
    assert.equal(levelName(0), 'No credit')
    assert.equal(markText(3, 8, 15), 'Level 3 · 8/15')
    assert.equal(markText(3, null, 15), 'Level 3')
    assert.equal(markText(0, null, 15), 'No credit · 0 marks')
    assert.equal(rangeText({ min: 4, max: 6 }), '4–6 marks')
    assert.equal(rangeText({ min: 0, max: 0 }), '0 marks')
})
