import FormData from 'form-data'
import fetch from 'node-fetch'
import config from '../config/index.js'
import { sanitizeAIResult } from '../utils/sanitize.js'

export async function getMarkFromAI(studentWorkFile, markSchemeFile) {
    const form = new FormData()

    form.append('student_work', studentWorkFile.buffer, {
        filename: studentWorkFile.originalname,
        contentType: studentWorkFile.mimetype,
    })

    form.append('mark_scheme', markSchemeFile.buffer, {
        filename: markSchemeFile.originalname,
        contentType: markSchemeFile.mimetype,
    })

    let response
    try {
        response = await fetch(`${config.AI_SERVICE_URL}/mark`, {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
        })
    } catch (fetchErr) {
        // Network-level failure — AI service is down or unreachable
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

    const raw = await response.json()
    const ocrStages = raw._ocr_stages
    const ocrMeta   = raw._ocr_meta
    const sanitized = sanitizeAIResult(raw)
    if (ocrStages) sanitized._ocr_stages = ocrStages
    if (ocrMeta)   sanitized._ocr_meta   = ocrMeta
    return sanitized
}
