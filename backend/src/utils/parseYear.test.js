import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseYear } from './parseYear.js'

describe('parseYear', () => {
    it('reads the year out of "Year N" phrasing', () => {
        assert.equal(parseYear('Year 10 Set 3'), 10)
    })

    it('reads a leading year digit with a suffix, e.g. "10e"', () => {
        assert.equal(parseYear('10e'), 10)
    })

    it('reads a bare leading year number', () => {
        assert.equal(parseYear('7 Maths'), 7)
    })

    // Found via manual QA: "7.5" was silently truncated to 7 instead of
    // being rejected — \d+ stops at the decimal point and just ignores
    // everything after it, so "7.5" (not a real year group) was accepted as
    // a perfectly valid "7".
    it('rejects a decimal instead of truncating it to the leading digit', () => {
        assert.equal(parseYear('7.5'), null)
    })

    it('rejects a decimal after "Year " phrasing too', () => {
        assert.equal(parseYear('Year 7.5 Set 2'), null)
    })

    it('returns null when there is no year at all', () => {
        assert.equal(parseYear('Set 3 English'), null)
    })
})
