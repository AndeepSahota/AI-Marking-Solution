import { fileTypeFromBuffer } from 'file-type'
import config from '../config/index.js'
import { logCheck } from '../logging/fileLogger.js'
import { stripMetadata } from './stripMetadata.js'

function secLog(req, slot, check, status, detail) {
    logCheck(req, slot, check, status, detail)
    if (process.env.NODE_ENV !== 'production') {
        req._securityLog.push({ source: 'backend', slot, check, status, detail })
    }
}

// Factory — pass the slots you want validated.
export function makeValidateFile(slots) {
    return async function validateFile(req, res, next) {
        for (const { field, label } of slots) {
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

            // 3. Strip metadata and re-encode
            const mimetypeBefore = file.mimetype
            const stripResult = await stripMetadata(file)
            const didConvert = file.mimetype !== mimetypeBefore
            secLog(req, label, 'metadata strip', 'pass',
                didConvert
                    ? `re-encoded ${mimetypeBefore} → ${file.mimetype}, ${(file.size / 1024).toFixed(0)} KB`
                    : `re-encoded ${file.mimetype}, ${(file.size / 1024).toFixed(0)} KB`
            )

            // 3a. Post-conversion size check
            const postSizeMB = file.size / (1024 * 1024)
            if (postSizeMB > config.MAX_FILE_SIZE_MB) {
                secLog(req, label, 'post-convert size', 'fail',
                    `${postSizeMB.toFixed(2)} MB after re-encoding — exceeds ${config.MAX_FILE_SIZE_MB} MB limit`)
                return res.status(400).json({ error: `File exceeds ${config.MAX_FILE_SIZE_MB} MB after processing` })
            }
            secLog(req, label, 'post-convert size', 'pass', `${postSizeMB.toFixed(2)} MB after re-encoding`)

            // 4. Log JS strip result (PDF only)
            if (mimetypeBefore === 'application/pdf') {
                const n = stripResult?.jsStripped ?? 0
                secLog(req, label, 'js strip', 'pass',
                    n > 0 ? `removed ${n} JS vector(s)` : 'no JS vectors found'
                )
            }
        }

        next()
    }
}
