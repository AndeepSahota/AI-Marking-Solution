import rateLimit from 'express-rate-limit'

export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
})

// Limits each user to 20 requests every 15 minutes. Stops someone from spamming your app and running up your AI compute costs.