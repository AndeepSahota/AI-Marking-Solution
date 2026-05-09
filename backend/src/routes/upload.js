import express from 'express'
import multer from 'multer'
import { fileSecurity } from '../middleware/fileSecurity.js'
import { validateFile } from '../middleware/validateFile.js'
import { getMarkFromAI } from '../services/aiService.js'
import {
    logOcrStart, logFileInfo, logAiDispatched,
    logOcrFileType, logOcrDims, logOcrPage,
    logOcrDone, logOcrFailed,
} from '../logging/ocrLogger.js'

const router = express.Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
})

router.post(
    '/',
    upload.fields([
        { name: 'studentWork', maxCount: 1 },
        { name: 'markScheme', maxCount: 1 }
    ]),
    fileSecurity,   // presence, size, extension, declared MIME
    validateFile,   // magic-byte detection, mismatch check, metadata strip
    async (req, res) => {
        // Stream newline-delimited JSON so the frontend receives events as they happen.
        // Security checks are already done by the time this handler fires — emit them
        // immediately, then start the AI call. The client sees the security log within
        // milliseconds while OCR runs in the background.
        res.setHeader('Content-Type', 'application/x-ndjson')
        res.setHeader('Transfer-Encoding', 'chunked')
        res.setHeader('Cache-Control', 'no-cache')

        const emit  = (obj) => res.write(JSON.stringify(obj) + '\n')
        const isDev = process.env.NODE_ENV !== 'production'

        // Emit security log immediately — before OCR starts
        if (isDev && req._securityLog?.length) {
            emit({ type: 'security', checks: req._securityLog })
        }

        const ocrStart = Date.now()
        logOcrStart(req)
        logFileInfo(req, 'STUDENT', req.files.studentWork[0])
        logFileInfo(req, 'SCHEME',  req.files.markScheme[0])

        try {
            logAiDispatched(req)
            const result = await getMarkFromAI(req.files.studentWork[0], req.files.markScheme[0])

            const swStages = result._ocr_stages?.studentWork ?? []
            const swMeta   = result._ocr_meta?.studentWork

            // Log file type and page count
            if (swMeta) logOcrFileType(req, swMeta)

            // Log per-page dims then timing
            if (swMeta?.pages) {
                for (const pageMeta of swMeta.pages) {
                    logOcrDims(req, pageMeta)
                    const matchingStage = swStages[pageMeta.index - 1]
                    if (matchingStage) logOcrPage(req, matchingStage, pageMeta)
                }
            }

            logOcrDone(req, swMeta?.page_count ?? swStages.length, swMeta?.total_chars ?? 0, Date.now() - ocrStart)

            const payload = { ...result }
            if (isDev) {
                if (result._ocr_stages) payload._ocrStages = result._ocr_stages
                if (result._ocr_meta)   payload._ocrMeta   = result._ocr_meta
            }
            delete payload._ocr_stages
            delete payload._ocr_meta
            emit({ type: 'result', data: payload })

        } catch (err) {
            logOcrFailed(req, err)
            emit({
                type:    'error',
                message: 'An unexpected error occurred',
                detail:  err.aiBody    ?? err.message ?? null,
                code:    err.aiErrorCode ?? null,
                status:  err.aiStatus  ?? null,
            })
        }

        res.end()
    }
)

export default router
