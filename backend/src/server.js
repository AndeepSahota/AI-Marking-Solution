import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { rateLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authenticate } from './middleware/authenticate.js'
import { inputSecurity } from './middleware/inputSecurity.js'
import authRoutes from './routes/auth.js'
import classRoutes from './routes/classes.js'
import lessonRoutes from './routes/lessons.js'
import exemplarRoutes from './routes/exemplars.js'
import config from './config/index.js'
import { pool, poolConnect } from './db/index.js'

const app = express()

// Trust the first hop proxy (Azure Container Apps ingress) so req.ip reflects
// the real client IP via X-Forwarded-For, rather than the proxy's address.
app.set('trust proxy', 1)

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:     ["'none'"],
            scriptSrc:      ["'self'"],
            styleSrc:       ["'self'"],
            fontSrc:        ["'self'"],
            imgSrc:         ["'self'", "data:"],
            connectSrc:     ["'self'"],
            baseUri:        ["'self'"],
            formAction:     ["'self'"],
            frameAncestors: ["'none'"],
        }
    }
}))
app.use(cors({
    origin: config.FRONTEND_URL,
    credentials: true,
}))
// Ahead of auth/rate-limiting deliberately — container orchestrators and
// load balancers poll this frequently and shouldn't need credentials or be
// subject to per-IP throttling meant for real traffic. Actually queries the
// DB (not just "the process is up") since the API is useless without it.
app.get('/health', async (_req, res) => {
    try {
        await pool.request().query('SELECT 1')
        res.json({ status: 'ok' })
    } catch (err) {
        res.status(503).json({ status: 'error', detail: err.message })
    }
})

app.use(cookieParser())
app.use(rateLimiter)
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/classes', authenticate, inputSecurity, classRoutes)
app.use('/lessons', authenticate, lessonRoutes)
app.use('/exemplars', authenticate, exemplarRoutes)

app.use(errorHandler)

// Async startup: prove the Azure SQL database is reachable BEFORE accepting
// traffic. The schema is applied out-of-band (db/schema.sql, run once by the
// Entra admin), so the app no longer runs DDL — it just connects. Fail fast if
// the DB is unreachable so Azure restarts us.
try {
    await poolConnect
    app.listen(config.PORT, () => {
        console.log(`Backend running on port ${config.PORT}`)
    })
} catch (err) {
    console.error('Failed to connect to the database:', err.message)
    process.exit(1)
}
