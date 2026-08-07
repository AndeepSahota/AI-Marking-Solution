import sql from 'mssql'
import config from '../config/index.js'

// Azure SQL connection pool. Authentication uses Entra ID through
// DefaultAzureCredential: the Container App's managed identity in Azure, or an
// authenticated developer identity locally. No database password is stored in
// source code or environment variables.
const dbConfig = {
    server: config.SQL_SERVER,
    database: config.SQL_DATABASE,
    authentication: { type: 'azure-active-directory-default' },
    options: {
        encrypt: true,
        trustServerCertificate: false,
    },
    connectionTimeout: 30000,
    // Keeping no idle connections open allows an Azure SQL serverless database
    // to auto-pause when the application is quiet.
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
}

export const pool = new sql.ConnectionPool(dbConfig)
export const poolConnect = pool.connect()

// Parameter descriptors keep every query explicitly typed. This prevents the
// driver or SQL Server from guessing types and preserves Unicode input.
const intParam = (name, value) => {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isSafeInteger(parsed)) {
        throw new TypeError(`${name} must be an integer`)
    }
    return { name, type: sql.Int, value: parsed }
}

const textParam = (name, length, value) => {
    if (typeof value !== 'string') {
        throw new TypeError(`${name} must be a string`)
    }
    return { name, type: sql.NVarChar(length), value }
}

// Execute against either the shared pool or an mssql Transaction. Accessor
// method signatures remain unchanged: methods use the pool by default, while
// transactional callers pass their Transaction as the optional executor `e`.
const exec = async (e, queryText, params = []) => {
    const request = new sql.Request(e)
    for (const { name, type, value } of params) {
        request.input(name, type, value)
    }
    return request.query(queryText)
}

async function inTransaction(work) {
    const transaction = new sql.Transaction(pool)
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)

    try {
        const result = await work(transaction)
        await transaction.commit()
        return result
    } catch (err) {
        // Preserve the original database/application error if SQL Server has
        // already aborted the transaction and rollback consequently also fails.
        try {
            await transaction.rollback()
        } catch (rollbackErr) {
            err.rollbackError = rollbackErr
        }
        throw err
    }
}

// Least-privilege application accessor for the teachers table.
export const teacherDb = {
    findByEmailHash: async (emailHash, e = pool) =>
        (await exec(e, `
            SELECT id, name, email_hash, password_hash, created_at
            FROM dbo.teachers
            WHERE email_hash = @emailHash
        `, [
            textParam('emailHash', 64, emailHash),
        ])).recordset[0],

    insert: async (name, emailHash, passwordHash, e = pool) =>
        (await exec(e, `
            INSERT INTO dbo.teachers (name, email_hash, password_hash)
            OUTPUT INSERTED.id
            VALUES (@name, @emailHash, @passwordHash)
        `, [
            textParam('name', 100, name),
            textParam('emailHash', 64, emailHash),
            textParam('passwordHash', 100, passwordHash),
        ])).recordset[0],
}

// Lessons are always joined through their class so teacher ownership remains
// part of the database predicate, not a frontend assumption.
const SQL_LIST_LESSONS = `
    SELECT l.id, l.lesson_title, l.class_id, l.created_at, c.class_name
    FROM dbo.lessons AS l
    JOIN dbo.classes AS c ON l.class_id = c.id
    WHERE c.teacher_id = @teacherId
    ORDER BY l.created_at DESC
`

const SQL_FIND_LESSON = `
    SELECT l.id, l.lesson_title, l.class_id, c.class_name
    FROM dbo.lessons AS l
    JOIN dbo.classes AS c ON l.class_id = c.id
    WHERE l.id = @lessonId AND c.teacher_id = @teacherId
`

const SQL_LESSON_CLASS_CHECK = `
    SELECT id, class_name
    FROM dbo.classes
    WHERE id = @classId AND teacher_id = @teacherId
`

// Central read for everything about a lesson's mark scheme — ownership-checked
// once here, reused by every endpoint that needs any piece of this data
// (GET /:id/ocr, GET /:id/questions) rather than each running its own query.
const SQL_LESSON_OCR_TEXT = `
    SELECT t.ocr_text, t.structured_scheme, t.selected_question_index
    FROM dbo.teacher_ocr AS t
    JOIN dbo.lessons AS l ON t.lesson_id = l.id
    JOIN dbo.classes AS c ON l.class_id = c.id
    WHERE l.id = @lessonId AND c.teacher_id = @teacherId
`

export const lessonDb = {
    listLessons: async (teacherId, e = pool) =>
        (await exec(e, SQL_LIST_LESSONS, [
            intParam('teacherId', teacherId),
        ])).recordset,

    findLesson: async (lessonId, teacherId, e = pool) =>
        (await exec(e, SQL_FIND_LESSON, [
            intParam('lessonId', lessonId),
            intParam('teacherId', teacherId),
        ])).recordset[0],

    findClass: async (classId, teacherId, e = pool) =>
        (await exec(e, SQL_LESSON_CLASS_CHECK, [
            intParam('classId', classId),
            intParam('teacherId', teacherId),
        ])).recordset[0],

    getOcrText: async (lessonId, teacherId, e = pool) =>
        (await exec(e, SQL_LESSON_OCR_TEXT, [
            intParam('lessonId', lessonId),
            intParam('teacherId', teacherId),
        ])).recordset[0],

    // Saves which question index the teacher selected for a multi-question paper.
    // Ownership enforced via the same lessons -> classes -> teacher_id join used
    // everywhere else in this file, not just trusted from the request.
    updateSelectedQuestion: async (lessonId, teacherId, index, e = pool) =>
        exec(e, `
            UPDATE t
            SET t.selected_question_index = @index
            FROM dbo.teacher_ocr AS t
            JOIN dbo.lessons AS l ON t.lesson_id = l.id
            JOIN dbo.classes AS c ON l.class_id = c.id
            WHERE l.id = @lessonId AND c.teacher_id = @teacherId
        `, [
            intParam('index', index),
            intParam('lessonId', lessonId),
            intParam('teacherId', teacherId),
        ]),

    // Insert the lesson and OCR row, then link them atomically. structuredScheme
    // comes from the mark-scheme extraction step (main.py's /ocr, via
    // extract_mark_scheme) — stored so per-student marking calls can reuse it
    // instead of re-extracting.
    createLesson: async (lessonTitle, classId, fileName, mimeType, ocrText, structuredScheme) =>
        inTransaction(async (transaction) => {
            const lesson = (await exec(transaction, `
                INSERT INTO dbo.lessons (
                    lesson_title,
                    class_id,
                    mark_scheme_file_name,
                    mark_scheme_mime_type
                )
                OUTPUT INSERTED.id
                VALUES (@lessonTitle, @classId, @fileName, @mimeType)
            `, [
                textParam('lessonTitle', 255, lessonTitle),
                intParam('classId', classId),
                textParam('fileName', 255, fileName),
                textParam('mimeType', 100, mimeType),
            ])).recordset[0]

            const ocr = (await exec(transaction, `
                INSERT INTO dbo.teacher_ocr (lesson_id, ocr_text, structured_scheme)
                OUTPUT INSERTED.id
                VALUES (@lessonId, @ocrText, @structuredScheme)
            `, [
                intParam('lessonId', lesson.id),
                textParam('ocrText', sql.MAX, ocrText),
                textParam('structuredScheme', sql.MAX, structuredScheme ?? ''),
            ])).recordset[0]

            await exec(transaction, `
                UPDATE dbo.lessons
                SET mark_scheme_ocr = @ocrId
                WHERE id = @lessonId
            `, [
                intParam('ocrId', ocr.id),
                intParam('lessonId', lesson.id),
            ])

            return lesson.id
        }),
}

// Every class/student method keeps the same optional executor signature so the
// route layer can compose multiple accessors into one mssql transaction.
export const classDb = {
    listClasses: async (teacherId, e = pool) =>
        (await exec(e, `
            SELECT
                c.id,
                c.class_name,
                c.year_group_id,
                CAST(COUNT(s.id) AS INT) AS student_count
            FROM dbo.classes AS c
            LEFT JOIN dbo.students AS s ON s.class_id = c.id
            WHERE c.teacher_id = @teacherId
            GROUP BY c.id, c.class_name, c.year_group_id
            ORDER BY c.class_name
        `, [
            intParam('teacherId', teacherId),
        ])).recordset,

    findClassById: async (classId, teacherId, e = pool) =>
        (await exec(e, `
            SELECT id, class_name, year_group_id
            FROM dbo.classes
            WHERE id = @classId AND teacher_id = @teacherId
        `, [
            intParam('classId', classId),
            intParam('teacherId', teacherId),
        ])).recordset[0],

    findClassByName: async (className, teacherId, e = pool) =>
        (await exec(e, `
            SELECT id
            FROM dbo.classes
            WHERE class_name = @className AND teacher_id = @teacherId
        `, [
            textParam('className', 100, className),
            intParam('teacherId', teacherId),
        ])).recordset[0],

    findClassByNameExcluding: async (className, teacherId, classId, e = pool) =>
        (await exec(e, `
            SELECT id
            FROM dbo.classes
            WHERE class_name = @className
              AND teacher_id = @teacherId
              AND id <> @classId
        `, [
            textParam('className', 100, className),
            intParam('teacherId', teacherId),
            intParam('classId', classId),
        ])).recordset[0],

    validateYear: async (yearId, e = pool) =>
        (await exec(e, `
            SELECT id
            FROM dbo.year_groups
            WHERE id = @yearId
        `, [
            intParam('yearId', yearId),
        ])).recordset[0],

    insertClass: async (className, yearGroupId, teacherId, e = pool) =>
        (await exec(e, `
            INSERT INTO dbo.classes (class_name, year_group_id, teacher_id)
            OUTPUT INSERTED.id
            VALUES (@className, @yearGroupId, @teacherId)
        `, [
            textParam('className', 100, className),
            intParam('yearGroupId', yearGroupId),
            intParam('teacherId', teacherId),
        ])).recordset[0],

    updateClass: async (className, yearGroupId, classId, e = pool) =>
        exec(e, `
            UPDATE dbo.classes
            SET class_name = @className, year_group_id = @yearGroupId
            WHERE id = @classId
        `, [
            textParam('className', 100, className),
            intParam('yearGroupId', yearGroupId),
            intParam('classId', classId),
        ]),

    listStudents: async (classId, e = pool) =>
        (await exec(e, `
            SELECT id, student_name
            FROM dbo.students
            WHERE class_id = @classId
            ORDER BY student_name
        `, [
            intParam('classId', classId),
        ])).recordset,

    findStudentByName: async (studentName, classId, e = pool) =>
        (await exec(e, `
            SELECT id
            FROM dbo.students
            WHERE student_name = @studentName AND class_id = @classId
        `, [
            textParam('studentName', 100, studentName),
            intParam('classId', classId),
        ])).recordset[0],

    findStudentByNameExcluding: async (studentName, classId, studentId, e = pool) =>
        (await exec(e, `
            SELECT id
            FROM dbo.students
            WHERE student_name = @studentName
              AND class_id = @classId
              AND id <> @studentId
        `, [
            textParam('studentName', 100, studentName),
            intParam('classId', classId),
            intParam('studentId', studentId),
        ])).recordset[0],

    findStudentById: async (studentId, classId, e = pool) =>
        (await exec(e, `
            SELECT id
            FROM dbo.students
            WHERE id = @studentId AND class_id = @classId
        `, [
            intParam('studentId', studentId),
            intParam('classId', classId),
        ])).recordset[0],

    insertStudent: async (studentName, classId, e = pool) =>
        (await exec(e, `
            INSERT INTO dbo.students (student_name, class_id)
            OUTPUT INSERTED.id
            VALUES (@studentName, @classId)
        `, [
            textParam('studentName', 100, studentName),
            intParam('classId', classId),
        ])).recordset[0],

    updateStudent: async (studentName, studentId, e = pool) =>
        exec(e, `
            UPDATE dbo.students
            SET student_name = @studentName
            WHERE id = @studentId
        `, [
            textParam('studentName', 100, studentName),
            intParam('studentId', studentId),
        ]),

    // Delete the student and their derived data in foreign-key-safe order.
    deleteStudent: async (studentId) =>
        inTransaction(async (transaction) => {
            await exec(transaction, `
                DELETE FROM dbo.marking_results
                WHERE student_id = @studentId
            `, [intParam('studentId', studentId)])

            await exec(transaction, `
                DELETE FROM dbo.student_ocr
                WHERE file_id IN (
                    SELECT id
                    FROM dbo.student_files
                    WHERE student_id = @studentId
                )
            `, [intParam('studentId', studentId)])

            await exec(transaction, `
                DELETE FROM dbo.student_files
                WHERE student_id = @studentId
            `, [intParam('studentId', studentId)])

            await exec(transaction, `
                DELETE FROM dbo.students
                WHERE id = @studentId
            `, [intParam('studentId', studentId)])
        }),

    // Execute fn atomically. fn receives an mssql Transaction which can be
    // passed unchanged to any accessor's optional executor argument.
    transaction: (fn) => inTransaction(fn),
}
