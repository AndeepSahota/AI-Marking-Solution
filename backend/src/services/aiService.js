import FormData from 'form-data'
import fetch from 'node-fetch'
import config from '../config/index.js'

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

    const response = await fetch(`${config.AI_SERVICE_URL}/mark`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
    })

    if (!response.ok) {
        throw new Error('AI service failed to process the files')
    }

    return response.json()
}