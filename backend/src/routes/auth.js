import express from 'express'
import jwt from 'jsonwebtoken'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { findByEmail, createUser, verifyPassword } from '../data/users.js'
import config from '../config/index.js'

const router = express.Router()

const TOKEN_EXPIRY = '1h'

// Load blacklist once at startup into a Set for O(1) lookups
const __dirname = dirname(fileURLToPath(import.meta.url))
const blacklist = new Set(
    readFileSync(join(__dirname, '../data/10k-most-common.txt'), 'utf-8')
        .split('\n')
        .map(p => p.trim().toLowerCase())
        .filter(Boolean)
)

function signToken(user) {
    return jwt.sign(
        { id: user.id, name: user.name },
        config.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    )
}

// POST /auth/signup
router.post('/signup', async (req, res, next) => {
    try {
        const { name, email, password, confirmPassword } = req.body

        if (!name?.trim() || !email?.trim() || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' })
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords do not match' })
        }
        if (password.length < 10) {
            return res.status(400).json({ error: 'Password must be at least 10 characters' })
        }
        if (!/[0-9]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one number' })
        }
        if ((password.match(/[^a-zA-Z0-9]/g) || []).length < 2) {
            return res.status(400).json({ error: 'Password must contain at least 2 special characters' })
        }
        if (blacklist.has(password.toLowerCase())) {
            return res.status(400).json({ error: 'This password is too common. Please choose a more unique password.' })
        }
        if (findByEmail(email)) {
            return res.status(409).json({ error: 'An account with that email already exists' })
        }

        const user = await createUser({ name: name.trim(), email, password })
        const token = signToken(user)

        res.status(201).json({ token, user })
    } catch (err) {
        next(err)
    }
})

// POST /auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body

        if (!email?.trim() || !password) {
            return res.status(400).json({ error: 'Email and password are required' })
        }

        const record = findByEmail(email)
        if (!record) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        const match = await verifyPassword(password, record.passwordHash)
        if (!match) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        const { passwordHash: _, ...user } = record
        const token = signToken(user)

        res.json({ token, user })
    } catch (err) {
        next(err)
    }
})

// POST /auth/refresh
// Verifies the token signature (ignoreExpiration: true) so a token that just
// expired can still be exchanged for a fresh one — no password required.
// A tampered or entirely invalid token is still rejected.
router.post('/refresh', (req, res) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' })
    }

    const token = authHeader.slice(7)
    try {
        const decoded = jwt.verify(token, config.JWT_SECRET, { ignoreExpiration: true })
        const newToken = signToken({ id: decoded.id, name: decoded.name })
        res.json({ token: newToken, user: { id: decoded.id, name: decoded.name } })
    } catch {
        return res.status(401).json({ error: 'Invalid token — cannot refresh' })
    }
})

// POST /auth/logout  (client clears token; this is a courtesy endpoint)
router.post('/logout', (req, res) => {
    res.json({ ok: true })
})

export default router
