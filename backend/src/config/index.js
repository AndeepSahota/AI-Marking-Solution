export default {
    PORT: process.env.PORT || 3001,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'http://localhost:8000',
    JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production',
    MAX_FILE_SIZE_MB: 10,
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
}
