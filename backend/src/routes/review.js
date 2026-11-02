// Teacher review of marked essays, behind TEACHER_REVIEW_ENABLED.
//   GET /lessons/:lessonId/review             class view: every marked essay + status
//   GET /lessons/:lessonId/review/:studentId  essay view
//   PUT /lessons/:lessonId/review/:studentId  save a review
// The browser only ever sends the teacher's choice. The engine's values are
// read from the database here, and the calibration internals (fine score,
// mark scheme fingerprint) are stored but never returned.
import { Router } from 'express'
import config from '../config/index.js'
import { lessonDb, reviewDb } from '../db/index.js'
import { inputSecurity } from '../middleware/inputSecurity.js'
import {
    ReviewInputError,
    chooseBlind,
    engineSnapshot,
    levelsFor,
    outcomeFor,
    parseReviewInput,
    publicEssay,
    publicListItem,
    selectedQuestionExtraction,
} from '../services/reviewService.js'

const router = Router()

// Scoped to the review paths only, so the other /lessons routes behave
// exactly as before.
router.use('/:lessonId/review', (req, res, next) => {
    if (!config.TEACHER_REVIEW_ENABLED) return res.status(404).json({ error: 'Not found' })
    next()
}, inputSecurity)

const ids = req => ({
    lessonId: Number.parseInt(req.params.lessonId, 10),
    studentId: req.params.studentId === undefined ? null : Number.parseInt(req.params.studentId, 10),
})

const validIds = ({ lessonId, studentId }) =>
    Number.isSafeInteger(lessonId) && lessonId > 0 && (studentId === null || (Number.isSafeInteger(studentId) && studentId > 0))

// Ownership-checked levels for the lesson's selected question, or an error
// response if the lesson isn't the teacher's or isn't reviewable.
async function lessonLevels(lessonId, teacherId, res) {
    const ocrRow = await lessonDb.getOcrText(lessonId, teacherId)
    if (!ocrRow) {
        res.status(404).json({ error: 'Lesson not found' })
        return null
    }
    const levels = levelsFor(selectedQuestionExtraction(ocrRow))
    if (!levels) {
        res.status(409).json({ error: 'Review is only available for questions marked by level on one assessment objective' })
        return null
    }
    return levels
}

router.get('/:lessonId/review', async (req, res, next) => {
    try {
        const { lessonId } = ids(req)
        if (!validIds(ids(req))) return res.status(400).json({ error: 'Invalid lesson' })
        const levels = await lessonLevels(lessonId, req.user.id, res)
        if (!levels) return

        await reviewDb.ensureBlindPicks(lessonId, req.user.id, chooseBlind)
        const items = (await reviewDb.listResults(lessonId, req.user.id)).map(publicListItem)
        res.json({
            progress: { reviewed: items.filter(item => item.review).length, total: items.length },
            items,
        })
    } catch (err) {
        next(err)
    }
})

router.get('/:lessonId/review/:studentId', async (req, res, next) => {
    try {
        const { lessonId, studentId } = ids(req)
        if (!validIds(ids(req))) return res.status(400).json({ error: 'Invalid essay' })
        const levels = await lessonLevels(lessonId, req.user.id, res)
        if (!levels) return

        const row = await reviewDb.getResult(lessonId, studentId, req.user.id)
        if (!row) return res.status(404).json({ error: 'No marked essay for this student' })
        res.json(publicEssay(row, levels))
    } catch (err) {
        next(err)
    }
})

router.put('/:lessonId/review/:studentId', async (req, res, next) => {
    try {
        const { lessonId, studentId } = ids(req)
        if (!validIds(ids(req))) return res.status(400).json({ error: 'Invalid essay' })
        const levels = await lessonLevels(lessonId, req.user.id, res)
        if (!levels) return

        const row = await reviewDb.getResult(lessonId, studentId, req.user.id)
        if (!row) return res.status(404).json({ error: 'No marked essay for this student' })

        const input = parseReviewInput(req.body, levels)
        const engine = engineSnapshot(row)
        if (!Number.isInteger(engine.mark) || !Number.isInteger(engine.maxMark)) {
            return res.status(409).json({ error: 'This essay has no mark to review' })
        }

        const saved = await reviewDb.saveReview({
            resultId: row.result_id,
            lessonId,
            studentId,
            teacherId: req.user.id,
            reviewMode: row.blind_pick && !row.review_id ? 'blind' : (row.review_mode ?? 'normal'),
            outcome: outcomeFor(engine, input),
            engine,
            ...input,
        })
        if (saved.locked) return res.status(409).json({ error: 'A blind check cannot be changed once saved' })

        // Re-read so a blind check now returns the revealed suggestion.
        const updated = await reviewDb.getResult(lessonId, studentId, req.user.id)
        res.json(publicEssay(updated, levels))
    } catch (err) {
        if (err instanceof ReviewInputError) return res.status(400).json({ error: err.message })
        next(err)
    }
})

export default router
