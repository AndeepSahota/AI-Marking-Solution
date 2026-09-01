import FormData from 'form-data'
import fetch from 'node-fetch'
import config from '../config/index.js'

// POST /ocr — single-file OCR only, no marking.
// Used for mark scheme processing at lesson start (first in the marking queue).
// Returns { text, stages, meta } from run_ocr() on the Python service.
export async function getOcrFromAI(file) {
    const form = new FormData()
    form.append('file', file.buffer, {
        filename:    file.originalname,
        contentType: file.mimetype,
    })

    let response
    try {
        response = await fetch(`${config.AI_SERVICE_URL}/ocr`, {
            method:  'POST',
            body:    form,
            headers: form.getHeaders(),
        })
    } catch (fetchErr) {
        const err = new Error('AI service unreachable')
        err.aiStatus    = null
        err.aiErrorCode = fetchErr.code ?? 'FETCH_ERROR'
        err.aiBody      = fetchErr.message
        throw err
    }

    if (!response.ok) {
        let body = ''
        try { body = await response.text() } catch (_) {}
        const err = new Error(`AI service returned HTTP ${response.status}`)
        err.aiStatus    = response.status
        err.aiErrorCode = `HTTP_${response.status}`
        err.aiBody      = body.slice(0, 300)
        throw err
    }

    return response.json()
}

// POST /mark-with-scheme-text — mark one student's work against one or more
// already-extracted questions (avoids re-OCRing/re-extracting the scheme on
// every student, and OCRs the student's file only once no matter how many
// questions are selected). `questions` is the array produced by
// resolveSelectedQuestions in lessons.js: [{ index, scheme }, ...].
//
// The AI service streams back one NDJSON result line per question (same
// convention as bulk-mark) rather than one JSON object — this reads that
// stream with the exact same reader/decoder/line-split loop already used for
// bulk-mark below, and returns the collected array of per-question results.
export async function getMarkFromAIWithSchemeText(studentWorkFile, questions, question = '', markSchemeText = '') {
    const form = new FormData()
    form.append('student_work', studentWorkFile.buffer, {
        filename:    studentWorkFile.originalname,
        contentType: studentWorkFile.mimetype,
    })
    form.append('questions',         JSON.stringify(questions.map(q => ({ index: q.index, scheme_text: q.scheme }))))
    form.append('question',          question)
    form.append('mark_scheme_text',  markSchemeText)

    let response
    try {
        response = await fetch(`${config.AI_SERVICE_URL}/mark-with-scheme-text`, {
            method:  'POST',
            body:    form,
            headers: form.getHeaders(),
        })
    } catch (fetchErr) {
        const err = new Error('AI service unreachable')
        err.aiStatus    = null
        err.aiErrorCode = fetchErr.code ?? 'FETCH_ERROR'
        err.aiBody      = fetchErr.message
        throw err
    }

    if (!response.ok) {
        let body = ''
        try { body = await response.text() } catch (_) {}
        const err = new Error(`AI service returned HTTP ${response.status}`)
        err.aiStatus    = response.status
        err.aiErrorCode = `HTTP_${response.status}`
        err.aiBody      = body.slice(0, 300)
        throw err
    }

    // node-fetch's response.body is a Node.js Readable stream, not a Web
    // ReadableStream — no .getReader() here (that's a browser-fetch/global-
    // fetch thing, which is what bulk-mark's reader loop in lessons.js relies
    // on instead). Node Readables are async-iterable though, so `for await`
    // reads the same chunks a different way.
    const decoder = new TextDecoder()
    let buffer = ''
    const results = []

    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line)

            if (event.type === 'result') {
                results.push(event)
            } else if (event.type === 'error') {
                const err = new Error(event.message || 'Marking failed')
                err.aiErrorCode = 'MARKING_QUESTION_FAILED'
                throw err
            }
        }
    }

    return results
}

