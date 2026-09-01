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
    logOcrDone, logOcrFailed, logExtractionWarning,
} from '../logging/ocrLogger.js'

const router = express.Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

const bulkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
})

const SLOTS = [{ field: 'markScheme', label: 'Mark Scheme' }]
const STUDENT_MARK_SLOTS = [{ field: 'studentWork', label: 'Student Work' }]

// Picks out the question-specific slices of structured_scheme the teacher
// selected on the question-picker page, so only those questions' AOs/bands go
// to the LLM — not the whole paper — for multi-question mark schemes. Falls
// back to the raw OCR text if there's no structured_scheme to parse at all.
// Returns an array — one { index, scheme } entry per selected question, even
// for the single-question case (an array of one) — so every caller loops
// the same way regardless of how many questions were selected.
function resolveSelectedQuestions(ocrRow) {
    if (!ocrRow.structured_scheme) return [{ index: 0, scheme: ocrRow.ocr_text }]
    let parsed
    try { parsed = JSON.parse(ocrRow.structured_scheme) } catch { return [{ index: 0, scheme: ocrRow.structured_scheme }] }

    const questions = parsed.questions
    if (!Array.isArray(questions) || questions.length === 0) return [{ index: 0, scheme: ocrRow.structured_scheme }]

    let indices
    try { indices = ocrRow.selected_question_indices ? JSON.parse(ocrRow.selected_question_indices) : null } catch { indices = null }
    if (!Array.isArray(indices) || indices.length === 0) indices = [0]   // same default as the old `?? 0`

    return indices.map(idx => ({ index: idx, scheme: JSON.stringify(questions[idx] ?? questions[0]) }))
}

// GET /lessons — all lessons belonging to the logged-in teacher, newest first.
router.get('/', async (req, res, next) => {
    try {
        res.json(await lessonDb.listLessons(req.user.id))
    } catch (err) {
        next(err)
    }
})

// GET /lessons/:id — return lesson metadata (title, class_id, class_name) for a lesson
// owned by this teacher. Used by StudentMarking to bootstrap itself from the URL alone.
router.get('/:id', async (req, res, next) => {
    try {
        const lesson = await lessonDb.findLesson(req.params.id, req.user.id)
        if (!lesson) return res.status(404).json({ error: 'Lesson not found' })
        res.json(lesson)
    } catch (err) {
        next(err)
    }
})

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

// GET /lessons/:id/questions — return the extracted {paper_type, questions[]} for
// a lesson owned by this teacher, read back from storage rather than trusting
// whatever was streamed at upload time. Backs the question-picker page so it
// works from a direct visit or a refresh, not just immediately after upload.
router.get('/:id/questions', async (req, res, next) => {
    try {
        const row = await lessonDb.getOcrText(req.params.id, req.user.id)
        if (!row) return res.status(404).json({ error: 'Lesson not found' })

        let parsedScheme = {}
        try { parsedScheme = row.structured_scheme ? JSON.parse(row.structured_scheme) : {} }
        catch { parsedScheme = {} }

        const paperType     = parsedScheme.paper_type ?? 'single'
        const questionsList = (parsedScheme.questions ?? []).map(q => ({
            question_number: q.question_number,
            marks:           q.marks,
            description:     q.description,
        }))

        res.json({ paper_type: paperType, questions: questionsList })
    } catch (err) {
        next(err)
    }
})

// PATCH /lessons/:id/select-question — store which question from a multi-question
// paper this lesson marks. Ownership is enforced inside updateSelectedQuestion,
// via the same lessons -> classes -> teacher_id join every other lessonDb method uses.
router.patch('/:id/select-question', async (req, res, next) => {
    try {
        const lessonId = parseInt(req.params.id)
        const { selectedQuestionIndices } = req.body
        if (!Array.isArray(selectedQuestionIndices) || selectedQuestionIndices.length === 0) {
            return res.status(400).json({ error: 'selectedQuestionIndices must be a non-empty array' })
        }
        await lessonDb.updateSelectedQuestion(lessonId, req.user.id, selectedQuestionIndices)
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

            // Pure arithmetic on the extracted structure itself (e.g. total_marks
            // doesn't match what the per-question breakdown sums to) — surfaced
            // immediately, while the teacher can still easily re-upload if the
            // mark scheme was genuinely misread. Not persisted — this is a
            // point-in-time check shown once at upload, not stored on the lesson.
            if (ocrResult.extraction_warnings?.length) {
                logExtractionWarning(req, ocrResult.extraction_warnings)
                emit({ type: 'extraction_warning', warnings: ocrResult.extraction_warnings })
            }

            const lessonTitle      = file.originalname.replace(/\.[^.]+$/, '')
            const cleanOcrText     = sanitiseOcrText(ocrResult.text ?? '')
            const question         = (req.body.question ?? '').trim()
            const structuredScheme = ocrResult.structured_scheme
                ? JSON.stringify(ocrResult.structured_scheme)
                : ''

            const lessonId = await lessonDb.createLesson(
                lessonTitle, classId, file.originalname, file.mimetype, file.buffer, cleanOcrText, question, structuredScheme
            )

            // Just enough to decide where Home.jsx navigates next — the full
            // question list itself lives in structured_scheme (already
            // persisted above) and is read back DB-side by SelectQuestion.jsx
            // via GET /:id/questions, not carried through this one-time stream.
            const parsedScheme         = ocrResult.structured_scheme ?? {}
            const hasMultipleQuestions = parsedScheme.paper_type === 'multi'
                && (parsedScheme.questions ?? []).length > 1

            emit({
                type: 'done',
                data: {
                    id:                     lessonId,
                    class_id:               classId,
                    class_name:             cls.class_name,
                    has_multiple_questions: hasMultipleQuestions,
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

// GET /lessons/:lessonId/results — all marking results for this lesson,
// scoped to the teacher's own classes via markingDb.getResults' join.
router.get('/:lessonId/results', async (req, res, next) => {
    try {
        const lessonId = parseInt(req.params.lessonId)
        const rows      = await markingDb.getResults(lessonId, req.user.id)
        const results   = rows.map(r => ({
            studentId: r.student_id,
            markedAt:  r.marked_at,
            result:    JSON.parse(r.student_grade),
        }))
        res.json({ results })
    } catch (err) {
        next(err)
    }
})

// POST /lessons/:lessonId/mark-student — upload one student's work, get AI
// marking against the already-extracted scheme, persist the result.
router.post('/:lessonId/mark-student',
    upload.fields([{ name: 'studentWork', maxCount: 1 }]),
    makeFileSecurity(STUDENT_MARK_SLOTS),
    makeValidateFile(STUDENT_MARK_SLOTS),
    async (req, res) => {
        const lessonId  = parseInt(req.params.lessonId)
        const studentId = parseInt(req.body.studentId)

        if (!studentId) return res.status(400).json({ error: 'Student ID is required' })

        const ocrRow = await lessonDb.getOcrText(lessonId, req.user.id)
        if (!ocrRow) return res.status(404).json({ error: 'Lesson not found' })
        const question = ocrRow.question ?? ''
        // Interim: only marks the first selected question until markingDb
        // (Phase 5) supports storing a result per selected question. Wrapped
        // in an array since getMarkFromAIWithSchemeText always takes a list.
        const questions = [resolveSelectedQuestions(ocrRow)[0]]

        const valid = await markingDb.validateStudent(studentId, lessonId, req.user.id)
        if (!valid) return res.status(404).json({ error: 'Student not found in this lesson' })

        res.setHeader('Content-Type',      'application/x-ndjson')
        res.setHeader('Transfer-Encoding', 'chunked')
        res.setHeader('Cache-Control',     'no-cache')

        const emit = (obj) => res.write(JSON.stringify(obj) + '\n')
        const file = req.files.studentWork[0]

        try {
            const aiResults = await getMarkFromAIWithSchemeText(file, questions, question, ocrRow.ocr_text ?? '')
            const aiResult  = aiResults[0]
            const sanitized = sanitizeAIResult(aiResult)

            await markingDb.markStudent(
                studentId, lessonId,
                file.originalname, file.mimetype, file.buffer,
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
        // Bulk-mark doesn't support multiple selected questions — always
        // marks against the first one only.
        const bulkScheme = resolveSelectedQuestions(ocrRow)[0].scheme

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
        form.append('mark_scheme_text',  ocrRow.ocr_text ?? '')
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
                        'bulk_upload.pdf', 'application/pdf', null,   // per-student PDF section never leaves the ai-service process
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