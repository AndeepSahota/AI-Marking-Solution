import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib'
import config from '../config/index.js'
import { logCheck } from '../logging/fileLogger.js'

// Writes to the rotating log file (always) and to req._securityLog for the
// frontend debug panel (dev only).
function secLog(req, slot, check, status, detail) {
    logCheck(req, slot, check, status, detail)
    if (process.env.NODE_ENV !== 'production') {
        req._securityLog.push({ source: 'backend', slot, check, status, detail })
    }
}

// ─── PDF JavaScript stripping ──────────────────────────────────────────────────
//
// PDF supports executable JavaScript in several locations. Each is stripped
// independently before the document is saved. The page content streams
// (text, images, vector graphics) are untouched — only action dictionaries
// and the JavaScript name tree are removed.
//
// Locations covered:
//   /OpenAction          — JS that runs when the document is opened
//   /AA on catalog       — document-level triggers (print, save, close)
//   /Names → /JavaScript — named JS actions referenced from anywhere in the doc
//   /AA on each page     — page open/close triggers
//   /A  on annotations   — link/widget click handlers (if action type is JS)
//   /AA on annotations   — additional annotation triggers
//   /AA on AcroForm fields — field JS (keystroke, validate, calculate)
//   /XFA on AcroForm     — XML Forms Architecture (JS-heavy alternative form system)

// Returns true if a resolved action dict is a JavaScript action
function isJSAction(obj) {
    if (!(obj instanceof PDFDict)) return false
    return obj.get(PDFName.of('S'))?.toString() === '/JavaScript'
}

// Strip /A (if JS) and /AA from an annotation or field dictionary.
// Returns the number of entries removed.
function stripDictActions(context, dict) {
    if (!(dict instanceof PDFDict)) return 0
    let n = 0
    if (dict.get(PDFName.of('AA'))) { dict.delete(PDFName.of('AA')); n++ }
    const actionRef = dict.get(PDFName.of('A'))
    if (actionRef && isJSAction(context.lookup(actionRef))) {
        dict.delete(PDFName.of('A')); n++
    }
    return n
}

// Recursively strip actions from AcroForm fields and their Kids.
// Returns the total count of entries removed.
function stripFieldActions(context, fields) {
    if (!(fields instanceof PDFArray)) return 0
    let n = 0
    for (let i = 0; i < fields.size(); i++) {
        const field = context.lookup(fields.get(i))
        if (!(field instanceof PDFDict)) continue
        n += stripDictActions(context, field)
        const kids = context.lookup(field.get(PDFName.of('Kids')))
        if (kids instanceof PDFArray) n += stripFieldActions(context, kids)
    }
    return n
}

// Returns the number of JavaScript vectors removed from the document.
function stripPdfJavaScript(doc) {
    const context = doc.context
    const catalog = doc.catalog
    let stripped = 0

    // 1. Document open action
    if (catalog.get(PDFName.of('OpenAction'))) {
        catalog.delete(PDFName.of('OpenAction')); stripped++
    }

    // 2. Document-level additional actions (print, save, close triggers)
    if (catalog.get(PDFName.of('AA'))) {
        catalog.delete(PDFName.of('AA')); stripped++
    }

    // 3. JavaScript name tree — /Names → /JavaScript
    const names = context.lookup(catalog.get(PDFName.of('Names')))
    if (names instanceof PDFDict && names.get(PDFName.of('JavaScript'))) {
        names.delete(PDFName.of('JavaScript')); stripped++
    }

    // 4. Per-page: page triggers and annotation actions
    for (const page of doc.getPages()) {
        const node = page.node
        if (node.get(PDFName.of('AA'))) { node.delete(PDFName.of('AA')); stripped++ }

        const annots = context.lookup(node.get(PDFName.of('Annots')))
        if (annots instanceof PDFArray) {
            for (let i = 0; i < annots.size(); i++) {
                const annot = context.lookup(annots.get(i))
                stripped += stripDictActions(context, annot)
            }
        }
    }

    // 5. AcroForm field actions and XFA
    const acroForm = context.lookup(catalog.get(PDFName.of('AcroForm')))
    if (acroForm instanceof PDFDict) {
        if (acroForm.get(PDFName.of('XFA'))) { acroForm.delete(PDFName.of('XFA')); stripped++ }
        stripped += stripFieldActions(context, context.lookup(acroForm.get(PDFName.of('Fields'))))
    }

    return stripped
}

// ─── Metadata stripping ────────────────────────────────────────────────────────

export async function stripMetadata(file) {
    switch (file.mimetype) {
        case 'image/jpeg': {
            file.buffer = await sharp(file.buffer)
                .jpeg({ quality: 95 })
                .toBuffer()
            break
        }
        case 'image/png': {
            // Verified as PNG by magic bytes and MIME match before reaching here.
            // Convert to JPEG so the lossy quantisation step destroys any LSB
            // steganographic payload — lossless PNG re-encoding would preserve it.
            file.buffer = await sharp(file.buffer)
                .jpeg({ quality: 95 })
                .toBuffer()
            file.mimetype = 'image/jpeg'
            break
        }
        case 'image/webp': {
            file.buffer = await sharp(file.buffer)
                .webp({ quality: 95 })
                .toBuffer()
            break
        }
        case 'image/heic':
        case 'image/heif': {
            file.buffer = await sharp(file.buffer)
                .jpeg({ quality: 95 })
                .toBuffer()
            file.mimetype = 'image/jpeg'
            break
        }
        case 'application/pdf': {
            const doc = await PDFDocument.load(file.buffer)

            // Strip Info dictionary metadata
            doc.setTitle('')
            doc.setAuthor('')
            doc.setSubject('')
            doc.setKeywords([])
            doc.setCreator('')
            doc.setProducer('')
            doc.setCreationDate(new Date(0))
            doc.setModificationDate(new Date(0))

            // Strip all JavaScript execution vectors
            const jsStripped = stripPdfJavaScript(doc)

            const bytes = await doc.save()
            file.buffer = Buffer.from(bytes)
            file.size = file.buffer.length
            return { jsStripped }
        }
    }
    file.size = file.buffer.length
    return null
}

// ─── validateFile ──────────────────────────────────────────────────────────────

export async function validateFile(req, res, next) {
    const SLOTS = [
        { field: 'studentWork', label: 'Student Work' },
        { field: 'markScheme',  label: 'Mark Scheme'  },
    ]

    for (const { field, label } of SLOTS) {
        const file = req.files[field][0]

        // 1. Magic-byte detection
        const detected = await fileTypeFromBuffer(file.buffer)

        if (!detected || !config.ALLOWED_MIME_TYPES.includes(detected.mime)) {
            secLog(req, label, 'magic bytes', 'fail',
                detected ? `detected ${detected.mime} — not in allowlist` : 'unrecognised file signature')
            return res.status(400).json({ error: 'Only PDF and image files are accepted' })
        }
        secLog(req, label, 'magic bytes', 'pass', `detected ${detected.mime}`)

        // 2. Declared vs detected mismatch
        if (detected.mime !== file.mimetype) {
            secLog(req, label, 'content match', 'fail',
                `declared ${file.mimetype} ≠ detected ${detected.mime}`)
            return res.status(400).json({ error: 'Only PDF and image files are accepted' })
        }
        secLog(req, label, 'content match', 'pass', `${detected.mime} consistent`)

        // 3. Strip metadata and JavaScript, re-encode
        const mimetypeBefore = file.mimetype
        const stripResult = await stripMetadata(file)
        const didConvert = file.mimetype !== mimetypeBefore
        secLog(req, label, 'metadata strip', 'pass',
            didConvert
                ? `re-encoded ${mimetypeBefore} → ${file.mimetype}, ${(file.size / 1024).toFixed(0)} KB`
                : `re-encoded ${file.mimetype}, ${(file.size / 1024).toFixed(0)} KB`
        )

        // 4. PDF JavaScript strip (PDF only)
        if (mimetypeBefore === 'application/pdf') {
            const n = stripResult?.jsStripped ?? 0
            secLog(req, label, 'js strip', 'pass',
                n > 0 ? `removed ${n} JS vector(s)` : 'no JS vectors found'
            )
        }
    }

    next()
}
