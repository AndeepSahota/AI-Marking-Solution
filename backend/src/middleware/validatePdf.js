import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib'

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

function isJSAction(obj) {
    if (!(obj instanceof PDFDict)) return false
    return obj.get(PDFName.of('S'))?.toString() === '/JavaScript'
}

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

function stripPdfJavaScript(doc) {
    const context = doc.context
    const catalog = doc.catalog
    let stripped = 0

    if (catalog.get(PDFName.of('OpenAction'))) {
        catalog.delete(PDFName.of('OpenAction')); stripped++
    }

    if (catalog.get(PDFName.of('AA'))) {
        catalog.delete(PDFName.of('AA')); stripped++
    }

    const names = context.lookup(catalog.get(PDFName.of('Names')))
    if (names instanceof PDFDict && names.get(PDFName.of('JavaScript'))) {
        names.delete(PDFName.of('JavaScript')); stripped++
    }

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

    const acroForm = context.lookup(catalog.get(PDFName.of('AcroForm')))
    if (acroForm instanceof PDFDict) {
        if (acroForm.get(PDFName.of('XFA'))) { acroForm.delete(PDFName.of('XFA')); stripped++ }
        stripped += stripFieldActions(context, context.lookup(acroForm.get(PDFName.of('Fields'))))
    }

    return stripped
}

// ─── stripPdfMetadata ──────────────────────────────────────────────────────────

export async function stripPdfMetadata(file) {
    const doc = await PDFDocument.load(file.buffer)

    doc.setTitle('')
    doc.setAuthor('')
    doc.setSubject('')
    doc.setKeywords([])
    doc.setCreator('')
    doc.setProducer('')
    doc.setCreationDate(new Date(0))
    doc.setModificationDate(new Date(0))

    const jsStripped = stripPdfJavaScript(doc)

    const bytes = await doc.save()
    file.buffer = Buffer.from(bytes)
    file.size = file.buffer.length
    return { jsStripped }
}
