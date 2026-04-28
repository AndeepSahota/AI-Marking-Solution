import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { rateLimiter, uploadLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authenticate } from './middleware/authenticate.js'
import uploadRoutes from './routes/upload.js'
import authRoutes from './routes/auth.js'
import config from './config/index.js'

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
app.use('/upload', authenticate, uploadLimiter, uploadRoutes)

app.use(errorHandler)

app.listen(config.PORT, () => {
    console.log(`Backend running on port ${config.PORT}`)
})
