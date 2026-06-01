// inputSecurity.js
// Sits between authenticate and any route that accepts string input.
// Runs on all /classes requests before classes.js sees the body.
// Controls are general purpose — any future route handling string input
// can be wired through here in server.js.

const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH  = 100
const MAX_OBJECT_DEPTH  = 5
const FORBIDDEN_KEYS    = new Set(['__proto__', 'constructor', 'prototype'])

// ── Prototype pollution guards ─────────────────────────────────────────────────

function hasForbiddenKeys(value, depth = 0) {
    if (depth > MAX_OBJECT_DEPTH) return false
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) return true
        if (hasForbiddenKeys(value[key], depth + 1)) return true
    }
    return false
}

function exceedsDepth(value, max, current = 0) {
    if (current > max) return true
    if (typeof value !== 'object' || value === null) return false
    const children = Array.isArray(value) ? value : Object.values(value)
    return children.some(v => exceedsDepth(v, max, current + 1))
}

// ── Pre-sanitisation checks ────────────────────────────────────────────────────

function hasOversizedString(value) {
    if (typeof value === 'string')                    return value.length > MAX_STRING_LENGTH
    if (Array.isArray(value))                         return value.some(hasOversizedString)
    if (typeof value === 'object' && value !== null)  return Object.values(value).some(hasOversizedString)
    return false
}

// ── String sanitisation ────────────────────────────────────────────────────────

function sanitiseString(str) {
    // Unicode normalisation — collapses lookalike characters to consistent form
    str = str.normalize('NFC')

    // Trim leading/trailing whitespace
    str = str.trim()

    // Null byte removal
    str = str.replace(/\0/g, '')

    // Control character removal — strips \x00-\x08, \x0B-\x1F, \x7F
    // Preserves \x09 (tab) and \x0A (newline LF) as legitimate whitespace
    str = str.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')

    // HTML tag stripping — removes <script>, <img>, any tag
    str = str.replace(/<[^>]*>/g, '')

    // Whitespace normalisation — collapses runs of spaces/tabs, limits newlines
    str = str.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')

    return str
}

// ── Recursive body walker ──────────────────────────────────────────────────────

function sanitiseValue(value) {
    if (typeof value === 'string')                   return sanitiseString(value)
    if (Array.isArray(value))                        return value.slice(0, MAX_ARRAY_LENGTH).map(sanitiseValue)
    if (typeof value === 'object' && value !== null) {
        const out = {}
        for (const [k, v] of Object.entries(value)) {
            out[k] = sanitiseValue(v)
        }
        return out
    }
    return value
}

// Exported so individual route files can apply string sanitisation
// and the shared length ceiling to specific fields outside the middleware chain.
export { sanitiseString, MAX_STRING_LENGTH }

// ── Middleware ─────────────────────────────────────────────────────────────────

export function inputSecurity(req, res, next) {
    if (!req.body || typeof req.body !== 'object') return next()

    // Prototype pollution — reject immediately
    if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Invalid request payload' })
    }

    // Excessive nesting — reject immediately
    if (exceedsDepth(req.body, MAX_OBJECT_DEPTH)) {
        return res.status(400).json({ error: 'Invalid request payload' })
    }

    // Oversized strings — reject before any processing
    if (hasOversizedString(req.body)) {
        return res.status(400).json({ error: 'Input exceeds maximum allowed length' })
    }

    // Sanitise — arrays truncated, strings cleaned, body replaced
    req.body = sanitiseValue(req.body)

    next()
}
