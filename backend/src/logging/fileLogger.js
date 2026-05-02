import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { fileURLToPath } from 'url'
import path from 'path'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs')

// ─── Log format ────────────────────────────────────────────────────────────────
//
// Every line follows a consistent pipe-delimited structure so it can be read
// by eye or parsed with simple tooling (grep, awk, jq if converted to JSON).
//
// Request start:
//   2026-04-30 14:23:45 | a3f2b1c4 | usr:abc123 | ── UPLOAD START ──────────────
//
// Check entry:
//   2026-04-30 14:23:45 | a3f2b1c4 | usr:abc123 | ✓ PASS | [Student Work]  magic bytes    | detected application/pdf
//   2026-04-30 14:23:45 | a3f2b1c4 | usr:abc123 | ✗ FAIL | [Student Work]  content match  | declared application/pdf ≠ detected image/jpeg

const lineFormat = winston.format.printf(({ timestamp, message, ...meta }) => {
    const rid = (meta.requestId ?? '????????').padEnd(8)
    const uid = `usr:${String(meta.userId ?? 'unknown').slice(0, 16)}`

    if (meta.event === 'request_start') {
        return `${timestamp} | ${rid} | ${uid} | ── UPLOAD START ${'─'.repeat(44)}`
    }

    const mark  = meta.status === 'pass' ? '✓ PASS' : '✗ FAIL'
    const slot  = `[${(meta.slot ?? '').padEnd(12)}]`
    const check = (meta.check ?? '').padEnd(16)
    return `${timestamp} | ${rid} | ${uid} | ${mark} | ${slot} ${check} | ${meta.detail ?? ''}`
})

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        lineFormat
    ),
    transports: [
        new DailyRotateFile({
            dirname:     LOG_DIR,
            filename:    'file-security-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles:    '30d',     // auto-delete logs older than 30 days
            maxSize:     '20m',     // rotate mid-day if a single file hits 20 MB
            auditFile:   path.join(LOG_DIR, '.audit.json'),
            level:       'info',
        }),
    ],
})

// ─── Exports ───────────────────────────────────────────────────────────────────

// Generate a short hex ID to correlate all checks in a single upload request.
// Stored on req so every middleware for the same request shares it.
export function generateRequestId() {
    return crypto.randomBytes(4).toString('hex')
}

// Log the start of an upload request — call once at the top of fileSecurity.
export function logUploadStart(req) {
    logger.info('', {
        event:     'request_start',
        requestId: req._requestId,
        userId:    req.user?.id ?? 'unknown',
    })
}

// Log a single security check result — called after every pass or fail.
// Pass → info level.  Fail → warn level (shows up in log monitoring alerts).
export function logCheck(req, slot, check, status, detail) {
    logger.log(status === 'pass' ? 'info' : 'warn', '', {
        requestId: req._requestId,
        userId:    req.user?.id ?? 'unknown',
        slot,
        check,
        status,
        detail,
    })
}
