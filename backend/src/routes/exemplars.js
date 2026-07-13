import express from 'express'
import multer from 'multer'
import FormData from 'form-data'
import fetch from 'node-fetch'
import config from '../config/index.js'
import { makeFileSecurity } from '../middleware/fileSecurity.js'
import { makeValidateFile } from '../middleware/validateFile.js'

const router  = express.Router()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
const SLOTS   = [{ field: 'file', label: 'Exemplar essay' }]

// GET /exemplars — list all stored exemplars
router.get('/', async (req, res, next) => {
    try {
        const response = await fetch(`${config.AI_SERVICE_URL}/exemplars`)
        if (!response.ok) return res.status(502).json({ error: 'AI service error' })
        const data = await response.json()
        res.json(data)
    } catch (err) {
        next(err)
    }
})

// POST /exemplars — upload an exemplar essay + metadata
router.post('/',
    upload.fields([{ name: 'file', maxCount: 1 }]),
    makeFileSecurity(SLOTS),
    makeValidateFile(SLOTS),
    async (req, res, next) => {
        try {
            const file = req.files.file[0]
            const { question_number, score, max_marks, band, source } = req.body

            if (!question_number || !score || !max_marks) {
                return res.status(400).json({ error: 'question_number, score, and max_marks are required' })
            }

            const form = new FormData()
            form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype })
            form.append('question_number', question_number)
            form.append('score',     String(score))
            form.append('max_marks', String(max_marks))
            if (band)   form.append('band',   String(band))
            if (source) form.append('source', source)

            const response = await fetch(`${config.AI_SERVICE_URL}/exemplars`, {
                method: 'POST', body: form, headers: form.getHeaders(),
            })

            if (!response.ok) {
                const body = await response.text().catch(() => '')
                return res.status(502).json({ error: 'AI service error', detail: body.slice(0, 200) })
            }

            res.json(await response.json())
        } catch (err) {
            next(err)
        }
    }
)

// DELETE /exemplars/:id
router.delete('/:id', async (req, res, next) => {
    try {
        const response = await fetch(`${config.AI_SERVICE_URL}/exemplars/${req.params.id}`, {
            method: 'DELETE',
        })
        if (response.status === 404) return res.status(404).json({ error: 'Exemplar not found' })
        if (!response.ok) return res.status(502).json({ error: 'AI service error' })
        res.json({ ok: true })
    } catch (err) {
        next(err)
    }
})

export default router
