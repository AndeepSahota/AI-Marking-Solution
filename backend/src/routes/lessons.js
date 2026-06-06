import express from 'express'
import multer from 'multer'
import { lessonDb } from '../db/index.js'
import { makeFileSecurity } from '../middleware/fileSecurity.js'
import { makeValidateFile } from '../middleware/validateFile.js'
import { getOcrFromAI } from '../services/aiService.js'
import { sanitiseOcrText } from '../middleware/inputSecurity.js'
import {
    logOcrStart, logFileInfo, logAiDispatched,
    logOcrFileType, logOcrDims, logOcrPage,
    logOcrDone, logOcrFailed,
} from '../logging/ocrLogger.js'

const router = express.Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

const SLOTS = [{ field: 'markScheme', label: 'Mark Scheme' }]

// GET /lessons — all lessons belonging to the logged-in teacher, newest first.
router.get('/', (req, res, next) => {
    try {
        res.json(lessonDb.listLessons(req.user.id))
    } catch (err) {
        next(err)
    }
})

// GET /lessons/:id — return lesson metadata (title, class_id, class_name) for a lesson
// owned by this teacher. Used by StudentMarking to bootstrap itself from the URL alone.
router.get('/:id', (req, res, next) => {
    try {
        const lesson = lessonDb.findLesson(req.params.id, req.user.id)
        if (!lesson) return res.status(404).json({ error: 'Lesson not found' })
        res.json(lesson)
    } catch (err) {
        next(err)
    }
})

// GET /lessons/:id/ocr — return the stored OCR text for a lesson owned by this teacher.
router.get('/:id/ocr', (req, res, next) => {
    try {
        const row = lessonDb.getOcrText(req.params.id, req.user.id)
        if (!row) return res.status(404).json({ error: 'Lesson not found' })
        res.json({ ocr_text: row.ocr_text })
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

        const cls = lessonDb.findClass(classId, req.user.id)
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

            const lessonTitle  = file.originalname.replace(/\.[^.]+$/, '')
            const cleanOcrText = sanitiseOcrText(ocrResult.text ?? '')

            const lessonId = lessonDb.createLesson(
                lessonTitle, classId, file.originalname, file.mimetype, cleanOcrText
            )

            emit({
                type: 'done',
                data: { id: lessonId, class_id: classId, class_name: cls.class_name },
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

export default router
