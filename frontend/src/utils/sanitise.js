// Client-side input sanitisation — mirrors inputSecurity.js on the backend.
// Applied before any API call so dangerous content is caught at the point of entry.

export const CLASS_NAME_MAX   = 100
export const STUDENT_NAME_MAX = 100
export const MAX_STUDENTS     = 100

// Applies unicode normalisation, strips null bytes and control characters,
// and collapses whitespace. HTML tags are detected separately via containsHtml
// so the user sees a clear error rather than silent modification.
export function sanitiseInput(value) {
    if (typeof value !== 'string') return value
    let s = value.normalize('NFC')
    s = s.replace(/\0/g, '')
    s = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    return s.trim()
}

// Returns true if the value contains HTML tag characters.
export function containsHtml(value) {
    return /[<>]/.test(value)
}

// Checks the payload object for prototype pollution keys and excessive depth.
// Returns an error string if invalid, null if clean.
export function validatePayload(obj, depth = 0) {
    if (depth > 5) return 'Request payload is too deeply nested'
    if (typeof obj !== 'object' || obj === null) return null
    const forbidden = ['__proto__', 'constructor', 'prototype']
    for (const key of Object.keys(obj)) {
        if (forbidden.includes(key)) return 'Request contains forbidden keys'
        const err = validatePayload(obj[key], depth + 1)
        if (err) return err
    }
    return null
}
