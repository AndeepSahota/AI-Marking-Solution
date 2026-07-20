import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const DB_PATH = join(__dirname, '..', 'data', 'aimira.sqlite')

const db = new Database(DB_PATH)

// WAL gives concurrent reads + a writer without blocking; foreign_keys must
// be enabled per-connection — SQLite defaults to off for backwards compat.
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Bootstrap schema before any prepare() calls — schema.js imports this module
// so tables must exist before it runs, otherwise prepare() throws on first use.
db.exec(`
    CREATE TABLE IF NOT EXISTS year_groups (
        id    INTEGER PRIMARY KEY,
        label TEXT    NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS teachers (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        email_hash    TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        class_name    TEXT    NOT NULL,
        year_group_id INTEGER NOT NULL REFERENCES year_groups(id),
        teacher_id    INTEGER NOT NULL REFERENCES teachers(id)
    );

    CREATE TABLE IF NOT EXISTS students (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        student_name TEXT    NOT NULL,
        class_id     INTEGER NOT NULL REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS lessons (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_title          TEXT    NOT NULL,
        class_id              INTEGER NOT NULL REFERENCES classes(id),
        mark_scheme_file_name TEXT    NOT NULL,
        mark_scheme_mime_type TEXT    NOT NULL,
        mark_scheme_ocr       INTEGER,
        created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );




    CREATE TABLE IF NOT EXISTS teacher_ocr (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id  INTEGER NOT NULL REFERENCES lessons(id),
        ocr_text   TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS student_files (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id  INTEGER NOT NULL REFERENCES students(id),
        lesson_id   INTEGER NOT NULL REFERENCES lessons(id),
        file_name   TEXT    NOT NULL,
        mime_type   TEXT    NOT NULL,
        uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS student_ocr (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id  INTEGER NOT NULL UNIQUE REFERENCES student_files(id),
        ocr_text TEXT    NOT NULL,
        ocr_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS marking_results (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id     INTEGER NOT NULL REFERENCES lessons(id),
        student_id    INTEGER NOT NULL REFERENCES students(id),
        ocr_id        INTEGER NOT NULL UNIQUE REFERENCES student_ocr(id),
        student_grade TEXT    NOT NULL,
        marked_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (lesson_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS mark_corrections (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id           INTEGER NOT NULL REFERENCES marking_results(id),
        teacher_id          INTEGER NOT NULL REFERENCES teachers(id),
        llm_score           INTEGER NOT NULL,
        teacher_correction  INTEGER,
        new_score           INTEGER NOT NULL,     
        corrected_at        TEXT    NOT NULL DEFAULT (datetime('now'))
        );

`)

// Add question column to existing databases that predate this field.
try { db.exec("ALTER TABLE lessons ADD COLUMN question TEXT NOT NULL DEFAULT ''") } catch (_) {}
// Add structured_scheme column to store the LLM-extracted mark scheme structure.
try { db.exec("ALTER TABLE teacher_ocr ADD COLUMN structured_scheme TEXT NOT NULL DEFAULT ''") } catch (_) {}
// Add selected_question_index so teachers can pick one question from a multi-question paper.
try { db.exec("ALTER TABLE teacher_ocr ADD COLUMN selected_question_index INTEGER DEFAULT NULL") } catch (_) {}

// Least-privilege accessor for the teachers table only.
// Prepared once at startup — users.js imports this instead of the raw db
// connection so it cannot run arbitrary SQL against any other table.
const _teacherFind   = db.prepare('SELECT * FROM teachers WHERE email_hash = ?')
const _teacherInsert = db.prepare('INSERT INTO teachers (name, email_hash, password_hash) VALUES (?, ?, ?)')

export const teacherDb = {
    findByEmailHash: (emailHash) => _teacherFind.get(emailHash),
    insert:          (name, emailHash, passwordHash) => _teacherInsert.run(name, emailHash, passwordHash),
}

// Least-privilege accessor for the lessons flow only.
// Covers: ownership check on classes, lesson creation, and OCR storage.
// lessons.js imports this instead of the raw db connection.
const _lessonClassCheck  = db.prepare('SELECT id, class_name FROM classes WHERE id = ? AND teacher_id = ?')
const _lessonInsert      = db.prepare('INSERT INTO lessons (lesson_title, class_id, mark_scheme_file_name, mark_scheme_mime_type, question) VALUES (?, ?, ?, ?, ?)')
const _teacherOcrInsert  = db.prepare('INSERT INTO teacher_ocr (lesson_id, ocr_text, structured_scheme) VALUES (?, ?, ?)')
const _lessonOcrLink     = db.prepare('UPDATE lessons SET mark_scheme_ocr = ? WHERE id = ?')
const _lessonOcrText     = db.prepare(`
    SELECT t.ocr_text, t.structured_scheme, t.selected_question_index, l.question
    FROM teacher_ocr t
    JOIN lessons l ON t.lesson_id = l.id
    JOIN classes c ON l.class_id = c.id
    WHERE l.id = ? AND c.teacher_id = ?
`)

const _updateSelectedQuestion = db.prepare(`
    UPDATE teacher_ocr SET selected_question_index = ?
    WHERE lesson_id IN (
        SELECT l.id FROM lessons l
        JOIN classes c ON c.id = l.class_id
        WHERE l.id = ? AND c.teacher_id = ?
    )
`)

const _lessonClassId = db.prepare(`
    SELECT l.class_id
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    WHERE l.id = ? AND c.teacher_id = ?
`)

const _createLessonTx = db.transaction((lessonTitle, classId, fileName, mimeType, ocrText, question, structuredScheme) => {
    const { lastInsertRowid: lessonId } = _lessonInsert.run(lessonTitle, classId, fileName, mimeType, question)
    const { lastInsertRowid: ocrId }    = _teacherOcrInsert.run(lessonId, ocrText, structuredScheme ?? '')
    _lessonOcrLink.run(ocrId, lessonId)
    return lessonId
})

export const lessonDb = {
    findClass:              (classId, teacherId)                                                          => _lessonClassCheck.get(classId, teacherId),
    createLesson:           (lessonTitle, classId, fileName, mimeType, ocrText, question, structuredScheme) => _createLessonTx(lessonTitle, classId, fileName, mimeType, ocrText, question, structuredScheme),
    getOcrText:             (lessonId, teacherId)                                         => _lessonOcrText.get(lessonId, teacherId),
    getClassId:             (lessonId, teacherId)                                         => _lessonClassId.get(lessonId, teacherId),
    updateSelectedQuestion: (lessonId, teacherId, index)                                  => _updateSelectedQuestion.run(index, lessonId, teacherId),
}

// Least-privilege accessor for the classes flow only.
// Covers all class and student CRUD operations.
// classes.js imports this instead of the raw db connection.
const _listClasses              = db.prepare(`
    SELECT c.id, c.class_name, c.year_group_id, COUNT(s.id) AS student_count
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id
    WHERE c.teacher_id = ?
    GROUP BY c.id
    ORDER BY c.class_name
`)
const _findClassById            = db.prepare('SELECT id, class_name, year_group_id FROM classes WHERE id = ? AND teacher_id = ?')
const _findClassByName          = db.prepare('SELECT id FROM classes WHERE class_name = ? AND teacher_id = ?')
const _findClassByNameExcluding = db.prepare('SELECT id FROM classes WHERE class_name = ? AND teacher_id = ? AND id != ?')
const _validateYear             = db.prepare('SELECT id FROM year_groups WHERE id = ?')
const _insertClass              = db.prepare('INSERT INTO classes (class_name, year_group_id, teacher_id) VALUES (?, ?, ?)')
const _updateClass              = db.prepare('UPDATE classes SET class_name = ?, year_group_id = ? WHERE id = ?')
const _listStudents             = db.prepare('SELECT id, student_name FROM students WHERE class_id = ? ORDER BY student_name')
const _findStudentByName        = db.prepare('SELECT id FROM students WHERE student_name = ? AND class_id = ?')
const _findStudentByNameExcluding = db.prepare('SELECT id FROM students WHERE student_name = ? AND class_id = ? AND id != ?')
const _findStudentById          = db.prepare('SELECT id FROM students WHERE id = ? AND class_id = ?')
const _insertStudent            = db.prepare('INSERT INTO students (student_name, class_id) VALUES (?, ?)')
const _updateStudent            = db.prepare('UPDATE students SET student_name = ? WHERE id = ?')
const _delMarkingResults        = db.prepare('DELETE FROM marking_results WHERE student_id = ?')
const _delStudentOcr            = db.prepare('DELETE FROM student_ocr WHERE file_id IN (SELECT id FROM student_files WHERE student_id = ?)')
const _delStudentFiles          = db.prepare('DELETE FROM student_files WHERE student_id = ?')
const _delStudent               = db.prepare('DELETE FROM students WHERE id = ?')

const _deleteStudentTx = db.transaction((studentId) => {
    _delMarkingResults.run(studentId)
    _delStudentOcr.run(studentId)
    _delStudentFiles.run(studentId)
    _delStudent.run(studentId)
})

export const classDb = {
    listClasses:               (teacherId)                         => _listClasses.all(teacherId),
    findClassById:             (classId, teacherId)                => _findClassById.get(classId, teacherId),
    findClassByName:           (className, teacherId)              => _findClassByName.get(className, teacherId),
    findClassByNameExcluding:  (className, teacherId, classId)     => _findClassByNameExcluding.get(className, teacherId, classId),
    validateYear:              (yearId)                            => _validateYear.get(yearId),
    insertClass:               (className, yearGroupId, teacherId) => _insertClass.run(className, yearGroupId, teacherId),
    updateClass:               (className, yearGroupId, classId)   => _updateClass.run(className, yearGroupId, classId),
    listStudents:              (classId)                           => _listStudents.all(classId),
    findStudentByName:         (studentName, classId)              => _findStudentByName.get(studentName, classId),
    findStudentByNameExcluding:(studentName, classId, studentId)   => _findStudentByNameExcluding.get(studentName, classId, studentId),
    findStudentById:           (studentId, classId)                => _findStudentById.get(studentId, classId),
    insertStudent:             (studentName, classId)              => _insertStudent.run(studentName, classId),
    updateStudent:             (studentName, studentId)            => _updateStudent.run(studentName, studentId),
    deleteStudent:             (studentId)                         => _deleteStudentTx(studentId),
    transaction:               (fn)                                => db.transaction(fn)(),
}

// ── Student marking accessors ─────────────────────────────────────────────────

const _validateStudentForLesson = db.prepare(`
    SELECT s.id
    FROM students s
    JOIN classes c ON c.id = s.class_id
    JOIN lessons l ON l.class_id = c.id
    WHERE s.id = ? AND l.id = ? AND c.teacher_id = ?
`)

const _getExistingMark = db.prepare(`
    SELECT mr.ocr_id, so.file_id
    FROM marking_results mr
    JOIN student_ocr so ON so.id = mr.ocr_id
    WHERE mr.lesson_id = ? AND mr.student_id = ?
`)

const _insertStudentFile   = db.prepare('INSERT INTO student_files (student_id, lesson_id, file_name, mime_type) VALUES (?, ?, ?, ?)')
const _insertStudentOcr    = db.prepare('INSERT INTO student_ocr (file_id, ocr_text) VALUES (?, ?)')
const _insertMarkingResult = db.prepare('INSERT INTO marking_results (lesson_id, student_id, ocr_id, student_grade) VALUES (?, ?, ?, ?)')
const _delMarkingResult    = db.prepare('DELETE FROM marking_results WHERE lesson_id = ? AND student_id = ?')
const _delStudentOcrById   = db.prepare('DELETE FROM student_ocr WHERE id = ?')
const _delStudentFileById  = db.prepare('DELETE FROM student_files WHERE id = ?')

const _markStudentTx = db.transaction((studentId, lessonId, fileName, mimeType, ocrText, gradeJson) => {
    const existing = _getExistingMark.get(lessonId, studentId)
    if (existing) {
        _delMarkingResult.run(lessonId, studentId)
        _delStudentOcrById.run(existing.ocr_id)
        _delStudentFileById.run(existing.file_id)
    }
    const { lastInsertRowid: fileId } = _insertStudentFile.run(studentId, lessonId, fileName, mimeType)
    const { lastInsertRowid: ocrId }  = _insertStudentOcr.run(fileId, ocrText)
    _insertMarkingResult.run(lessonId, studentId, ocrId, gradeJson)
})

const _getMarkingResults = db.prepare(`
    SELECT mr.student_id, mr.student_grade, mr.marked_at
    FROM marking_results mr
    JOIN lessons l ON l.id = mr.lesson_id
    JOIN classes c ON c.id = l.class_id
    WHERE mr.lesson_id = ? AND c.teacher_id = ?
`)

export const markingDb = {
    validateStudent: (studentId, lessonId, teacherId) => _validateStudentForLesson.get(studentId, lessonId, teacherId),
    markStudent:     (studentId, lessonId, fileName, mimeType, ocrText, gradeJson) =>
                         _markStudentTx(studentId, lessonId, fileName, mimeType, ocrText, gradeJson),
    getResults:      (lessonId, teacherId) => _getMarkingResults.all(lessonId, teacherId),
}

export default db
