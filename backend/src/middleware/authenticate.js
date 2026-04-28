import jwt from 'jsonwebtoken'
import config from '../config/index.js'

export function authenticate(req, res, next) {
    const token = req.cookies?.aimira_token
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' })
    }

    try {
        req.user = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] })
        next()
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}
