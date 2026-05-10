import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import heicConvert from 'heic-convert'
import config from '../config/index.js'
import { logCheck } from '../logging/fileLogger.js'
import { stripPdfMetadata } from './validatePdf.js'

// Writes to the rotating log file (always) and to req._securityLog for the
// frontend debug panel (dev only).
function secLog(req, slot, check, status, detail) {
    logCheck(req, slot, check, status, detail)
    if (process.env.NODE_ENV !== 'production') {
        req._securityLog.push({ source: 'backend', slot, check, status, detail })
    }
}

// ─── Metadata stripping ────────────────────────────────────────────────────────

export async function stripMetadata(file) {
    switch (file.mimetype) {
        case 'image/jpeg': {
            file.buffer = await sharp(file.buffer)
                .jpeg({ quality: 95 })
                .toBuffer()
            break
        }
        case 'image/png': {
            // Verified as PNG by magic bytes and MIME match before reaching here.
            // Convert to JPEG so the lossy quantisation step destroys any LSB
            // steganographic payload — lossless PNG re-encoding would preserve it.
            file.buffer = await sharp(file.buffer)
                .jpeg({ quality: 95 })
                .toBuffer()
            file.mimetype = 'image/jpeg'
            break
        }
        case 'image/webp': {
            file.buffer = await sharp(file.buffer)
                .webp({ quality: 95 })
                .toBuffer()
            break
        }
        case 'image/heic':
        case 'image/heif': {
            const jpegArrayBuffer = await heicConvert({ buffer: file.buffer, format: 'JPEG', quality: 0.95 })
            file.buffer = await sharp(Buffer.from(jpegArrayBuffer)).jpeg({ quality: 95 }).toBuffer()
            file.mimetype = 'image/jpeg'
            break
        }
        case 'application/pdf': {
            return stripPdfMetadata(file)
        }
    }
    file.size = file.buffer.length
    return null
}

// ─── validateFile ──────────────────────────────────────────────────────────────

export async function validateFile(req, res, next) {
    const SLOTS = [
        { field: 'studentWork', label: 'Student Work' },
        { field: 'markScheme',  label: 'Mark Scheme'  },
    ]

    for (const { field, label } of SLOTS) {
        const file = req.files[field][0]

        // 1. Magic-byte detection
        const detected = await fileTypeFromBuffer(file.buffer)

        if (!detected || !config.ALLOWED_MIME_TYPES.includes(detected.mime)) {
            secLog(req, label, 'magic bytes', 'fail',
                detected ? `detected ${detected.mime} — not in allowlist` : 'unrecognised file signature')
            return res.status(400).json({ error: 'Only PDF and image files are accepted' })
        }
        secLog(req, label, 'magic bytes', 'pass', `detected ${detected.mime}`)

        // 2. Declared vs detected mismatch
        if (detected.mime !== file.mimetype) {
            secLog(req, label, 'content match', 'fail',
                `declared ${file.mimetype} ≠ detected ${detected.mime}`)
            return res.status(400).json({ error: 'Only PDF and image files are accepted' })
        }
        secLog(req, label, 'content match', 'pass', `${detected.mime} consistent`)

        // 3. Strip metadata and JavaScript, re-encode.
        //    Images are handled inline in stripMetadata; PDFs are delegated to validatePdf.js.
        //    The secLog below only records the outcome — all processing is already complete.
        const mimetypeBefore = file.mimetype
        const stripResult = await stripMetadata(file)
        const didConvert = file.mimetype !== mimetypeBefore
        secLog(req, label, 'metadata strip', 'pass',
            didConvert
                ? `re-encoded ${mimetypeBefore} → ${file.mimetype}, ${(file.size / 1024).toFixed(0)} KB`
                : `re-encoded ${file.mimetype}, ${(file.size / 1024).toFixed(0)} KB`
        )

        // 3a. Post-conversion size check — HEIC in particular expands significantly
        //     when converted to JPEG. The original size check passed on the compressed
        //     input; this catches the inflated output before it reaches the AI service.
        const postSizeMB = file.size / (1024 * 1024)
        if (postSizeMB > config.MAX_FILE_SIZE_MB) {
            secLog(req, label, 'post-convert size', 'fail',
                `${postSizeMB.toFixed(2)} MB after re-encoding — exceeds ${config.MAX_FILE_SIZE_MB} MB limit`)
            return res.status(400).json({ error: `File exceeds ${config.MAX_FILE_SIZE_MB} MB after processing` })
        }
        secLog(req, label, 'post-convert size', 'pass', `${postSizeMB.toFixed(2)} MB after re-encoding`)

        // 4. Log JS strip result (PDF only) — logging only.
        //    The actual stripping was already performed inside validatePdf.js during step 3.
        //    stripResult carries the count of vectors removed; this block surfaces it to the log.
        if (mimetypeBefore === 'application/pdf') {
            const n = stripResult?.jsStripped ?? 0
            secLog(req, label, 'js strip', 'pass',
                n > 0 ? `removed ${n} JS vector(s)` : 'no JS vectors found'
            )
        }
    }

    next()
}
