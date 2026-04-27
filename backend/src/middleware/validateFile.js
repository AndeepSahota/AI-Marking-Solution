import config from '../config/index.js'

export function validateFile(req, res, next) {
    const files = [req.files?.studentWork?.[0], req.files?.markScheme?.[0]]

    for (const file of files) {
        if (!file) {
            return res.status(400).json({ error: 'Both files are required' })
        }

        if (!config.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return res.status(400).json({ error: 'Only PDF and image files are accepted' })
        }

        const sizeMB = file.size / (1024 * 1024)
        if (sizeMB > config.MAX_FILE_SIZE_MB) {
            return res.status(400).json({ error: `Files must be under ${config.MAX_FILE_SIZE_MB} MB` })
        }
    }

    next()
}

// Checks every uploaded file before it goes anywhere near your AI model. Rejects anything that isn't an image or PDF, and anything over 10MB. This is your first security gate.