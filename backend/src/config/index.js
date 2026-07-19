export default {
    PORT: process.env.PORT || 3001,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'http://localhost:8000',
    JWT_SECRET: (() => {
        if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
        return process.env.JWT_SECRET
    })(),
    PASSWORD_PEPPER: (() => {
        if (!process.env.PASSWORD_PEPPER) throw new Error('PASSWORD_PEPPER environment variable is not set')
        return process.env.PASSWORD_PEPPER
    })(),
    EMAIL_PEPPER: (() => {
        if (!process.env.EMAIL_PEPPER) throw new Error('EMAIL_PEPPER environment variable is not set')
        return process.env.EMAIL_PEPPER
    })(),
    // Azure SQL Database connection target. The app authenticates with an Entra
    // managed identity ('Active Directory Default'), so there is NO password or
    // connection string secret — only the server host and database name. The
    // mssql config object is assembled in db/index.js. Mirrors the ADO.NET string:
    //   Server=tcp:klassioserver.database.windows.net,1433;Initial Catalog=KlassioDatabase;...
    SQL_SERVER: process.env.SQL_SERVER || 'klassioserver.database.windows.net',
    SQL_DATABASE: process.env.SQL_DATABASE || 'KlassioDatabase',
    MAX_FILE_SIZE_MB: 5,
    MAX_PDF_PAGES: 30,
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'],
}
