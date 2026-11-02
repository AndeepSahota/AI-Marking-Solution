// Student work goes from the browser straight to Blob storage, so it never
// passes the backend's file checks on the way in. This runs straight after
// the upload (POST .../upload-complete) and again before marking as a
// backstop: it checks the real file type from its bytes, strips metadata --
// phone photos carry GPS location, PDFs an author -- and keeps only the
// cleaned copy. A file already cleaned is left alone.
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'
import config from '../config/index.js'
import { stripMetadata } from '../middleware/stripMetadata.js'
import {
    deleteStudentUpload,
    downloadStudentWork,
    findStudentUpload,
    keepOnlyStudentUpload,
    replaceStudentUpload,
} from './blobService.js'

export class UploadRejectedError extends Error {}

const EXTENSION_FOR = {
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
}

// Returns the student's (cleaned) upload, or null if there is none.
export async function cleanStudentUpload(teacherId, lessonId, studentId) {
    const upload = await findStudentUpload(teacherId, lessonId, studentId)
    if (!upload) return null
    if (upload.cleaned) {
        // Clean already; just make sure no older, uncleaned copy is kept.
        await keepOnlyStudentUpload(teacherId, lessonId, studentId, upload.blobName)
        return upload
    }

    const buffer = await downloadStudentWork(upload.blobName)
    const detected = await fileTypeFromBuffer(buffer)
    if (!detected || !config.ALLOWED_MIME_TYPES.includes(detected.mime)) {
        await deleteStudentUpload(upload.blobName)
        throw new UploadRejectedError('Only JPEG, PNG, WebP, HEIC and PDF files can be marked')
    }

    const file = { buffer, mimetype: detected.mime }
    try {
        await stripMetadata(file)
    } catch {
        await deleteStudentUpload(upload.blobName)
        throw new UploadRejectedError('This file could not be read. Please upload it again.')
    }

    // PNG and HEIC come out as JPEG, so the name follows the new format --
    // the worker passes the name and type on to OCR.
    const cleanedName = `${path.parse(upload.fileName).name}.${EXTENSION_FOR[file.mimetype]}`
    await replaceStudentUpload(teacherId, lessonId, studentId, cleanedName, file.buffer, file.mimetype)
    return { ...upload, fileName: cleanedName, mimeType: file.mimetype, cleaned: true }
}
