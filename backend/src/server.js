import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authenticate } from './middleware/authenticate.js'
import uploadRoutes from './routes/upload.js'
import authRoutes from './routes/auth.js'
import config from './config/index.js'

const app = express()

app.use(helmet())
app.use(cors({
    origin: config.FRONTEND_URL,
    credentials: true,
}))
app.use(rateLimiter)
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/upload', authenticate, uploadRoutes)

app.use(errorHandler)

app.listen(config.PORT, () => {
    console.log(`Backend running on port ${config.PORT}`)
})
