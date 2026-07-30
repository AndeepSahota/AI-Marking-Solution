import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { rateLimiter, uploadLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authenticate } from './middleware/authenticate.js'
import { inputSecurity } from './middleware/inputSecurity.js'
import uploadRoutes from './routes/upload.js'
import authRoutes from './routes/auth.js'
import classRoutes from './routes/classes.js'
import lessonRoutes from './routes/lessons.js'
import exemplarRoutes from './routes/exemplars.js'
import config from './config/index.js'
import { pool } from './db/index.js'
import { initSchema } from './db/schema.js'

const app = express()

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
app.use(cookieParser())
app.use(rateLimiter)
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/classes', authenticate, inputSecurity, classRoutes)
app.use('/lessons', authenticate, lessonRoutes)
app.use('/upload',    authenticate, uploadLimiter, uploadRoutes)
app.use('/exemplars', authenticate, exemplarRoutes)

app.use(errorHandler)

// Async startup: build the schema (and prove the DB is reachable) BEFORE
// accepting traffic. Fail fast if the DB is unreachable so the process restarts.
try {
    await initSchema(pool)
    app.listen(config.PORT, () => {
        console.log(`Backend running on port ${config.PORT}`)
    })
} catch (err) {
    console.error('Failed to initialise the database:', err.message)
    process.exit(1)
}
