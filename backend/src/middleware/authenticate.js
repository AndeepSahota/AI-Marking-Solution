import jwt from 'jsonwebtoken'
import config from '../config/index.js'

export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' })
    }

    const token = authHeader.slice(7)
    try {
        req.user = jwt.verify(token, config.JWT_SECRET)
        next()
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}
