// One-off clean-up of student uploads stored before metadata stripping
// existed (services/uploadCleaner.js). Each student's latest upload is
// re-encoded without metadata (GPS location, camera details, PDF author) and
// every older or uncleaned copy is deleted.
//
// Dry run by default -- it only lists what it would do:
//     npm run blob:clean
//     npm run blob:clean -- --apply
import { listAllStudentUploads } from '../src/services/blobService.js'
import { UploadRejectedError, cleanStudentUpload } from '../src/services/uploadCleaner.js'

const apply = process.argv.includes('--apply')

const students = new Map()
for await (const blob of listAllStudentUploads()) {
    const key = `${blob.teacherId}/${blob.lessonId}/${blob.studentId}`
    const entry = students.get(key) ?? { ...blob, files: 0, uncleaned: 0 }
    entry.files += 1
    if (!blob.cleaned) entry.uncleaned += 1
    students.set(key, entry)
}

// A student needs cleaning if any of their files is uncleaned, or if old
// copies are still kept alongside the cleaned one.
const toClean = [...students.values()].filter(entry => entry.uncleaned > 0 || entry.files > 1)
console.log(`${students.size} students with uploads; ${toClean.length} need cleaning.`)
if (!apply) {
    console.log('Dry run: nothing changed. Run with --apply to clean them.')
    process.exit(0)
}

let cleaned = 0
let rejected = 0
for (const entry of toClean) {
    try {
        await cleanStudentUpload(entry.teacherId, entry.lessonId, entry.studentId)
        cleaned += 1
    } catch (err) {
        if (!(err instanceof UploadRejectedError)) throw err
        rejected += 1
        console.log(`Removed unreadable upload for lesson ${entry.lessonId}, student ${entry.studentId}: ${err.message}`)
    }
}
console.log(`Cleaned ${cleaned}; removed ${rejected} unreadable.`)
