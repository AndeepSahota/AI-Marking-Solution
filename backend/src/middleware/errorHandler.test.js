import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import multer from 'multer'
import { errorHandler } from './errorHandler.js'

// Minimal fake Express response — just enough to capture what errorHandler
// sends, without needing a real HTTP server.
function fakeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { res.statusCode = code; return res },
        json(body) { res.body = body; return res },
    }
    return res
}

describe('errorHandler', () => {
    // Found via manual QA: uploading an oversized mark scheme returned "An
    // unexpected error occurred" instead of a readable size-limit message.
    // multer enforces its own file-size limit before anything else runs, and
    // throws its own MulterError — nothing here was catching that specific
    // error type, so it fell through to the generic 500 catch-all below.
    it('gives a clean, specific message for a MulterError file-size limit', () => {
        const err = new multer.MulterError('LIMIT_FILE_SIZE')
        const res = fakeRes()

        errorHandler(err, {}, res, () => {})

        assert.equal(res.statusCode, 400)
        assert.notEqual(res.body.error, 'An unexpected error occurred')
        assert.match(res.body.error, /large/i)
    })

    it('still falls back to the generic message for a genuinely unexpected error', () => {
        const err = new Error('something genuinely unforeseen broke')
        const res = fakeRes()

        errorHandler(err, {}, res, () => {})

        assert.equal(res.statusCode, 500)
        assert.equal(res.body.error, 'An unexpected error occurred')
    })
})
