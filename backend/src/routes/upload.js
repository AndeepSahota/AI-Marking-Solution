import express from 'express'
import multer from 'multer'
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
    validateFile,
    async (req, res, next) => {
        try {
            const studentWork = req.files.studentWork[0]
            const markScheme = req.files.markScheme[0]
            const result = await getMarkFromAI(studentWork, markScheme)
            res.json(result)
        } catch (err) {
            next(err)
        }
    }
)

export default router

// Defines what happens when the browser sends files to /upload. 
// It runs three things in order — first multer receives the files, then validateFile checks they're safe, then it forwards them to the AI and sends the result back.