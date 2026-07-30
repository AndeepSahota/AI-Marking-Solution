import express from 'express'
import multer from 'multer'
import config from '../config/index.js'
import { lessonDb, markingDb, classDb } from '../db/index.js'
import { makeFileSecurity } from '../middleware/fileSecurity.js'
import { makeValidateFile } from '../middleware/validateFile.js'
import { getOcrFromAI, getMarkFromAIWithSchemeText } from '../services/aiService.js'
import { sanitizeAIResult } from '../utils/sanitize.js'
import { sanitiseOcrText } from '../middleware/inputSecurity.js'
import {
    logOcrStart, logFileInfo, logAiDispatched,
    logOcrFileType, logOcrDims, logOcrPage,
    logOcrDone, logOcrFailed,
} from '../logging/ocrLogger.js'

const router = express.Router()

// Extracts the correct question-specific scheme from an ocrRow.
// For multi-question papers the teacher picks a question index; we send only
// that question's AOs and bands to the LLM rather than the whole paper.
function resolveScheme(ocrRow) {
    if (!ocrRow.structured_scheme) return ocrRow.ocr_text
    let parsed
    try { parsed = JSON.parse(ocrRow.structured_scheme) } catch { return ocrRow.structured_scheme }

    const questions = parsed.questions
    if (!Array.isArray(questions) || questions.length === 0) return ocrRow.structured_scheme

    const idx = ocrRow.selected_question_index ?? 0
    const question = questions[idx] ?? questions[0]
    return JSON.stringify(question)
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

const bulkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
})

const SLOTS = [{ field: 'markScheme', label: 'Mark Scheme' }]

// GET /lessons/:id/ocr — return the stored OCR text and question for a lesson owned by this teacher.
router.get('/:id/ocr', async (req, res, next) => {
    try {
        const row = await lessonDb.getOcrText(req.params.id, req.user.id)
        if (!row) return res.status(404).json({ error: 'Lesson not found' })
        res.json({ ocr_text: row.ocr_text, question: row.question })
    } catch (err) {
        next(err)
    }
})


// PATCH /lessons/:id/select-question — store which question from a multi-question paper this lesson marks
router.patch('/:id/select-question', express.json(), async (req, res, next) => {
    try {
        const lessonId = parseInt(req.params.id)
        const { selectedQuestionIndex } = req.body
        if (selectedQuestionIndex === undefined || selectedQuestionIndex === null) {
            return res.status(400).json({ error: 'selectedQuestionIndex is required' })
        }
        await lessonDb.updateSelectedQuestion (lessonId, req.user.id, selectedQuestionIndex)
        res.json({ ok: true })
    } catch (err) {
        next(err)
    }
})

// POST /lessons — security-check the mark scheme, OCR it, store the result.
// Streams newline-delimited JSON so the frontend can drive a progress bar.
router.post('/',
    upload.fields([{ name: 'markScheme', maxCount: 1 }]),
    makeFileSecurity(SLOTS),
    makeValidateFile(SLOTS),
    async (req, res) => {
        const classId = parseInt(req.body.classId)
        if (!classId) return res.status(400).json({ error: 'Class is required' })

        const cls = await lessonDb.findClass(classId, req.user.id)
        if (!cls) return res.status(404).json({ error: 'Class not found' })

        res.setHeader('Content-Type',     'application/x-ndjson')
        res.setHeader('Transfer-Encoding', 'chunked')
        res.setHeader('Cache-Control',     'no-cache')

        const emit  = (obj) => res.write(JSON.stringify(obj) + '\n')
        const isDev = process.env.NODE_ENV !== 'production'

        if (isDev && req._securityLog?.length) {
            emit({ type: 'security', checks: req._securityLog })
        }

        const file       = req.files.markScheme[0]
        const ocrStart   = Date.now()

        logOcrStart(req)
        logFileInfo(req, 'SCHEME', file)
        emit({ type: 'security_pass' })

        try {
            logAiDispatched(req)
            emit({ type: 'ai_dispatched' })

            const ocrResult = await getOcrFromAI(file)

            const stages = ocrResult.stages ?? []
            const meta   = ocrResult.meta

            if (meta) {
                logOcrFileType(req, meta)
                emit({ type: 'ocr_file_type', fileType: meta.file_type, pageCount: meta.page_count })
            }

            if (meta?.pages) {
                for (const pageMeta of meta.pages) {
                    logOcrDims(req, pageMeta)
                    const matchingStage = stages[pageMeta.index - 1]
                    if (matchingStage) logOcrPage(req, matchingStage, pageMeta)
                    emit({ type: 'ocr_page', index: pageMeta.index, totalPages: meta.page_count })
                }
            }

            logOcrDone(req, meta?.page_count ?? stages.length, meta?.total_chars ?? 0, Date.now() - ocrStart)

            const lessonTitle      = file.originalname.replace(/\.[^.]+$/, '')
            const cleanOcrText    = sanitiseOcrText(ocrResult.text ?? '')
            const question        = (req.body.question ?? '').trim()
            const structuredScheme = ocrResult.structured_scheme
                ? JSON.stringify(ocrResult.structured_scheme)
                : ''

            const lessonId = await lessonDb.createLesson(
                lessonTitle, classId, file.originalname, file.mimetype, cleanOcrText, question, structuredScheme
            )

            const parsedScheme  = ocrResult.structured_scheme ?? {}
            const paperType     = parsedScheme.paper_type ?? 'single'
            const questionsList = (parsedScheme.questions ?? []).map(q => ({
                question_number: q.question_number,
                marks:           q.marks,
                description:     q.description,
            }))

            emit({
                type: 'done',
                data: {
                    id:         lessonId,
                    class_id:   classId,
                    class_name: cls.class_name,
                    paper_type: paperType,
                    questions:  questionsList,
                },
            })
        } catch (err) {
            logOcrFailed(req, err)
            emit({
                type:    'error',
                message: 'An unexpected error occurred',
                detail:  err.aiBody      ?? err.message ?? null,
                code:    err.aiErrorCode ?? null,
                status:  err.aiStatus    ?? null,
            })
        }

        res.end()
    }
)

const STUDENT_MARK_SLOTS = [{ field: 'studentWork', label: 'Student Work' }]

// GET /lessons/:lessonId/results — all marking results for this lesson
router.get('/:lessonId/results', async (req, res, next) => {
    try {
        const lessonId = parseInt(req.params.lessonId)
        const rows     = await markingDb.getResults(lessonId, req.user.id)
        const results  = rows.map(r => ({
            studentId: r.student_id,
            markedAt:  r.marked_at,
            result:    JSON.parse(r.student_grade),
        }))
        res.json({ results })
    } catch (err) {
        next(err)
    }
})

// POST /lessons/:lessonId/mark-student — upload student work, get AI marking, persist result
router.post('/:lessonId/mark-student',
    upload.fields([{ name: 'studentWork', maxCount: 1 }]),
    makeFileSecurity(STUDENT_MARK_SLOTS),
    makeValidateFile(STUDENT_MARK_SLOTS),
    async (req, res) => {
        const lessonId  = parseInt(req.params.lessonId)
        const studentId = parseInt(req.body.studentId)

        if (!studentId) return res.status(400).json({ error: 'Student ID is required' })

        const ocrRow   = await lessonDb.getOcrText(lessonId, req.user.id)
        if (!ocrRow) return res.status(404).json({ error: 'Lesson not found' })
        const question = ocrRow.question ?? ''
        const scheme   = resolveScheme(ocrRow)

        const valid = await markingDb.validateStudent(studentId, lessonId, req.user.id)
        if (!valid) return res.status(404).json({ error: 'Student not found in this lesson' })

        res.setHeader('Content-Type',      'application/x-ndjson')
        res.setHeader('Transfer-Encoding', 'chunked')
        res.setHeader('Cache-Control',     'no-cache')

        const emit = (obj) => res.write(JSON.stringify(obj) + '\n')
        const file = req.files.studentWork[0]

        try {
            const aiResult  = await getMarkFromAIWithSchemeText(file, scheme, question)
            const sanitized = sanitizeAIResult(aiResult)

            await markingDb.markStudent(
                studentId, lessonId,
                file.originalname, file.mimetype,
                aiResult.student_ocr_text ?? '',
                JSON.stringify(sanitized)
            )

            emit({ type: 'result', data: sanitized })
        } catch (err) {
            emit({
                type:    'error',
                message: 'Marking failed',
                detail:  err.aiBody      ?? err.message ?? null,
                code:    err.aiErrorCode ?? null,
                status:  err.aiStatus    ?? null,
            })
        }

        res.end()
    }
)

// POST /lessons/:lessonId/bulk-mark — upload one PDF covering the whole class
router.post('/:lessonId/bulk-mark',
    bulkUpload.fields([{ name: 'pdfFile', maxCount: 1 }]),
    async (req, res) => {
        const lessonId        = parseInt(req.params.lessonId)
        const pagesPerStudent = parseInt(req.body.pagesPerStudent)

        if (!pagesPerStudent || pagesPerStudent < 1) {
            return res.status(400).json({ error: 'Pages per student is required' })
        }

        const ocrRow = await lessonDb.getOcrText(lessonId, req.user.id)
        if (!ocrRow) return res.status(404).json({ error: 'Lesson not found' })
        const bulkScheme = resolveScheme(ocrRow)

        const lessonClass = await lessonDb.getClassId(lessonId, req.user.id)
        if (!lessonClass) return res.status(404).json({ error: 'Lesson class not found' })

        const students = await classDb.listStudents(lessonClass.class_id)

        const file = req.files?.pdfFile?.[0]
        if (!file) return res.status(400).json({ error: 'PDF file is required' })

        res.setHeader('Content-Type',      'application/x-ndjson')
        res.setHeader('Transfer-Encoding', 'chunked')
        res.setHeader('Cache-Control',     'no-cache')

        const emit = (obj) => res.write(JSON.stringify(obj) + '\n')

        const form = new FormData()
        form.append('pdf_file', file.buffer, {
            filename:    file.originalname,
            contentType: file.mimetype,
        })
        form.append('scheme_text',       bulkScheme)
        form.append('question',          ocrRow.question ?? '')
        form.append('pages_per_student', String(pagesPerStudent))
        form.append('students',          JSON.stringify(students.map(s => ({ id: s.id, name: s.student_name }))))

        let aiResponse
        try {
            aiResponse = await fetch(`${config.AI_SERVICE_URL}/bulk-mark-with-scheme-text`, {
                method:  'POST',
                body:    form,
                headers: form.getHeaders(),
            })
        } catch (fetchErr) {
            emit({ type: 'error', message: 'AI service unreachable' })
            return res.end()
        }

        const reader  = aiResponse.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()

            for (const line of lines) {
                if (!line.trim()) continue
                const event = JSON.parse(line)

                if (event.type === 'result' && event.student_id) {
                    const sanitized = sanitizeAIResult(event)
                    await markingDb.markStudent(
                        event.student_id, lessonId,
                        'bulk_upload.pdf', 'application/pdf',
                        event.student_ocr_text ?? '',
                        JSON.stringify(sanitized)
                    )
                    emit({
                        type:       'result',
                        studentId:  event.student_id,
                        studentName: event.student_name,
                        confidence: event.match_confidence,
                        data:       sanitized,
                    })
                } else {
                    emit(event)
                }
            }
        }

        res.end()
    }
)

export default router
