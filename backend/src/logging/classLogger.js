import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs')

// ─── Log format ────────────────────────────────────────────────────────────────
//
// 2026-05-09 10:23:45 | a3f2b1c4 | usr:1 | ── CLASS REQUEST ──────────────────────────────────
// 2026-05-09 10:23:45 | a3f2b1c4 | usr:1 | CLASS    | 10e              | Year 10
// 2026-05-09 10:23:45 | a3f2b1c4 | usr:1 | STUDENTS | 3 added          | india, john, jane
// 2026-05-09 10:23:45 | a3f2b1c4 | usr:1 | ✓ DONE   | class_id: 1      | 3 students
// 2026-05-09 10:23:45 | a3f2b1c4 | usr:1 | ✗ FAILED | validation       | Class name must start with a valid year

const lineFormat = winston.format.printf(({ timestamp, message, ...meta }) => {
    const rid    = (meta.requestId ?? '????????').padEnd(8)
    const uid    = `usr:${String(meta.userId ?? 'unknown').slice(0, 16)}`
    const prefix = `${timestamp} | ${rid} | ${uid}`

    switch (meta.event) {
        case 'class_start':
            return `${prefix} | ── CLASS REQUEST ${'─'.repeat(43)}`

        case 'class_created': {
            const name = (meta.className ?? '').padEnd(16).slice(0, 16)
            const year = `Year ${meta.yearGroupId}`
            return `${prefix} | CLASS    | ${name} | ${year}`
        }

        case 'students_added': {
            const count   = `${meta.count} added`.padEnd(16)
            const preview = (meta.names ?? []).slice(0, 5).join(', ')
            const more    = meta.count > 5 ? ` +${meta.count - 5} more` : ''
            return `${prefix} | STUDENTS | ${count} | ${preview}${more}`
        }

        case 'class_done': {
            const classId = `class_id: ${meta.classId}`.padEnd(16)
            const count   = `${meta.studentCount} student${meta.studentCount === 1 ? '' : 's'}`
            return `${prefix} | ✓ DONE   | ${classId} | ${count}`
        }

        case 'class_failed': {
            const reason = (meta.reason ?? 'ERROR').toString().padEnd(16)
            const detail = (meta.detail ?? '').slice(0, 120)
            return `${prefix} | ✗ FAILED | ${reason} | ${detail}`
        }

        default:
            return `${prefix} | ${message}`
    }
})

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        lineFormat
    ),
    transports: [
        new DailyRotateFile({
            dirname:     LOG_DIR,
            filename:    'class-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles:    '30d',
            maxSize:     '20m',
            auditFile:   path.join(LOG_DIR, '.class-audit.json'),
            level:       'info',
        }),
    ],
})

// ─── Exports ───────────────────────────────────────────────────────────────────

export function logClassStart(req) {
    logger.info('', { event: 'class_start', requestId: req._requestId, userId: req.user?.id })
}

export function logClassCreated(req, className, yearGroupId) {
    logger.info('', {
        event:       'class_created',
        requestId:   req._requestId,
        userId:      req.user?.id,
        className,
        yearGroupId,
    })
}

export function logStudentsAdded(req, names) {
    logger.info('', {
        event:     'students_added',
        requestId: req._requestId,
        userId:    req.user?.id,
        count:     names.length,
        names,
    })
}

export function logClassDone(req, classId, studentCount) {
    logger.info('', {
        event:        'class_done',
        requestId:    req._requestId,
        userId:       req.user?.id,
        classId,
        studentCount,
    })
}

export function logClassFailed(req, reason, detail) {
    logger.warn('', {
        event:     'class_failed',
        requestId: req._requestId,
        userId:    req.user?.id,
        reason,
        detail,
    })
}
