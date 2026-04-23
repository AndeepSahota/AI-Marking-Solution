import express from 'express'
import jwt from 'jsonwebtoken'
import { findByEmail, createUser, verifyPassword } from '../data/users.js'
import config from '../config/index.js'

const router = express.Router()

const TOKEN_EXPIRY = '1h'

function signToken(user) {
    return jwt.sign(
        { id: user.id, name: user.name, email: user.email },
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
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' })
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

// POST /auth/logout  (client clears token; this is a courtesy endpoint)
router.post('/logout', (req, res) => {
    res.json({ ok: true })
})

export default router
