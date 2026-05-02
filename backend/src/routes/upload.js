import express from 'express'
import multer from 'multer'
import { fileSecurity } from '../middleware/fileSecurity.js'
import { validateFile } from '../middleware/validateFile.js'
import { getMarkFromAI } from '../services/aiService.js'

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
    async (req, res, next) => {
        try {
            const studentWork = req.files.studentWork[0]
            const markScheme = req.files.markScheme[0]
            const result = await getMarkFromAI(studentWork, markScheme)
            const response = (process.env.NODE_ENV !== 'production' && req._securityLog?.length)
                ? { ...result, _debug: req._securityLog }
                : result
            res.json(response)
        } catch (err) {
            next(err)
        }
    }
)

export default router
