import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { makeFileSecurity } from './fileSecurity.js'

// Minimal fakes — same trick as errorHandler.test.js. We don't need a real
// server or a real multer upload; the middleware only ever touches
// req.files[field][0] and calls res.status()/res.json().
function fakeReq(field, file) {
    return { files: { [field]: [file] } }
}

function fakeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { res.statusCode = code; return res },
        json(body) { res.body = body; return res },
    }
    return res
}

const SLOTS = [{ field: 'studentWork', label: 'Student Work' }]

describe('makeFileSecurity', () => {
    // Found via manual QA (MRK-04): marking a student with a blank file
    // returned "An unexpected error occurred" instead of a readable message.
    // Turned out to be the exact same root cause as SEC-03's fake-PDF bug —
    // a 0-byte file declared as a PDF has no real PDF structure inside it,
    // so PDFDocument.load() throws when this check tries to read its page
    // count. Already fixed in fileSecurity.js; this locks that fix in.
    it('rejects a blank file cleanly instead of crashing', async () => {
        const fileSecurity = makeFileSecurity(SLOTS)
        const req = fakeReq('studentWork', {
            originalname: 'blank.pdf',
            size:         0,
            mimetype:     'application/pdf',
            buffer:       Buffer.alloc(0),
        })
        const res = fakeRes()

        await fileSecurity(req, res, () => {})

        assert.equal(res.statusCode, 400)
        assert.equal(res.body.error, "This file doesn't appear to be a valid PDF")
    })

    // Found via a Playwright e2e run (frontend/e2e/upload-validation.spec.js):
    // a file with a real "%PDF-" header but garbage content after it returned
    // "An unexpected error occurred" instead of the clean message above.
    // Different root cause from the blank-file case: here PDFDocument.load()
    // succeeds (pdf-lib is lenient about a header with no real structure
    // behind it) but doc.getPageCount() throws reading the (missing) page
    // tree — and that call sat outside the try/catch, so it fell straight
    // through to the generic error handler.
    it('rejects a file with a real PDF header but no real PDF structure', async () => {
        const fileSecurity = makeFileSecurity(SLOTS)
        const buffer = Buffer.from('%PDF-1.7\n' + 'not a real pdf structure, just text after the header'.repeat(20))
        const req = fakeReq('studentWork', {
            originalname: 'corrupt.pdf',
            size:         buffer.length,
            mimetype:     'application/pdf',
            buffer,
        })
        const res = fakeRes()

        await fileSecurity(req, res, () => {})

        assert.equal(res.statusCode, 400)
        assert.equal(res.body.error, "This file doesn't appear to be a valid PDF")
    })

    // Regression guard — proves the fix above didn't start rejecting real
    // PDFs too. Builds an actual minimal PDF with pdf-lib (the same library
    // the app uses), rather than trusting a fixture file we can't see fail.
    it('lets a genuinely valid PDF through untouched', async () => {
        const doc = await PDFDocument.create()
        doc.addPage()
        const bytes = await doc.save()

        const fileSecurity = makeFileSecurity(SLOTS)
        const req = fakeReq('studentWork', {
            originalname: 'real-essay.pdf',
            size:         bytes.length,
            mimetype:     'application/pdf',
            buffer:       Buffer.from(bytes),
        })
        const res = fakeRes()

        let nextCalled = false
        await fileSecurity(req, res, () => { nextCalled = true })

        assert.equal(nextCalled, true)
        assert.equal(res.statusCode, null)
    })
})
