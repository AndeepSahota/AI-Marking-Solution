// multer enforces its own upload limits (file size, file count, ...) before
// any of our own validation middleware ever runs, and throws its own
// MulterError when one is hit — a real, specific, expected failure, not a
// genuine crash. Without translating it here, it fell through to the same
// generic 500 as an actual unforeseen bug, on every upload route at once
// (mark scheme, student work, bulk, exemplars) since they all use multer.
const MULTER_ERROR_MESSAGES = {
    LIMIT_FILE_SIZE:      'This file is too large to upload',
    LIMIT_FILE_COUNT:     'Too many files were uploaded at once',
    LIMIT_UNEXPECTED_FILE: 'An unexpected file field was uploaded',
}

export function errorHandler(err, req, res, _next) {
    console.error(err.stack)

    if (err.name === 'MulterError') {
        const message = MULTER_ERROR_MESSAGES[err.code] || 'This file could not be uploaded'
        return res.status(400).json({ error: message })
    }

    const body = { error: 'An unexpected error occurred' }
    if (process.env.NODE_ENV !== 'production' && req._securityLog?.length) {
        body._debug = req._securityLog
    }
    res.status(err.status || 500).json(body)
}

// If anything crashes anywhere in the backend, this catches it and sends a clean error message back to the browser. 
// Without this, the browser would just hang or get a confusing raw crash message.