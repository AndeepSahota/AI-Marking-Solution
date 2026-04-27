import rateLimit from 'express-rate-limit'

// Global limiter — covers all routes, keyed by IP
export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
})

// Upload limiter — 50 submissions per authenticated user per hour.
// Must be mounted AFTER the authenticate middleware so req.user is available.
// Falls back to IP if req.user is somehow absent (authenticate would have
// already rejected those requests, so the fallback is just defensive).
export const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 50,
    keyGenerator: (req) => `upload:${req.user?.id ?? req.ip}`,
    message: { error: 'Upload limit reached. You can submit up to 50 files per hour.' },
    standardHeaders: true,
    legacyHeaders: false,
})