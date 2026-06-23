import pg from 'pg'
import config from '../config/index.js'

// node-postgres connection pool. SQLite was a single in-process file handle;
// Postgres is a separate server, so we keep a pool of reusable TCP connections.
// SSL: Azure Postgres requires it (sslmode=require in the connection string);
// the local docker-compose Postgres doesn't — so enable it conditionally.
const useSsl = /sslmode=require/i.test(config.DATABASE_URL)
export const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
})

// Run a query on the pool by default, or on a transaction client when one is
// passed as `e`. This lets the same accessor method work standalone OR inside a
// transaction (see classDb.transaction), so all the SQL stays in this file.
const exec = (e, sql, params) => e.query(sql, params)

// ── Least-privilege accessor for the teachers table only. ──
// users.js imports this instead of the raw pool, so it cannot run arbitrary SQL.
export const teacherDb = {
    findByEmailHash: async (emailHash, e = pool) =>
        (await exec(e, 'SELECT * FROM teachers WHERE email_hash = $1', [emailHash])).rows[0],
    insert: async (name, emailHash, passwordHash, e = pool) =>
        (await exec(e,
            'INSERT INTO teachers (name, email_hash, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [name, emailHash, passwordHash])).rows[0],
}

// ── Least-privilege accessor for the lessons flow only. ──
const SQL_LIST_LESSONS = `
    SELECT l.id, l.lesson_title, l.class_id, l.created_at, c.class_name
    FROM lessons l
    JOIN classes c ON l.class_id = c.id
    WHERE c.teacher_id = $1
    ORDER BY l.created_at DESC
`
const SQL_FIND_LESSON = `
    SELECT l.id, l.lesson_title, l.class_id, c.class_name
    FROM lessons l
    JOIN classes c ON l.class_id = c.id
    WHERE l.id = $1 AND c.teacher_id = $2
`
const SQL_LESSON_CLASS_CHECK = 'SELECT id, class_name FROM classes WHERE id = $1 AND teacher_id = $2'
const SQL_LESSON_OCR_TEXT = `
    SELECT t.ocr_text
    FROM teacher_ocr t
    JOIN lessons l ON t.lesson_id = l.id
    JOIN classes c ON l.class_id = c.id
    WHERE l.id = $1 AND c.teacher_id = $2
`

export const lessonDb = {
    listLessons: async (teacherId, e = pool)          => (await exec(e, SQL_LIST_LESSONS, [teacherId])).rows,
    findLesson:  async (lessonId, teacherId, e = pool) => (await exec(e, SQL_FIND_LESSON, [lessonId, teacherId])).rows[0],
    findClass:   async (classId, teacherId, e = pool)  => (await exec(e, SQL_LESSON_CLASS_CHECK, [classId, teacherId])).rows[0],
    getOcrText:  async (lessonId, teacherId, e = pool) => (await exec(e, SQL_LESSON_OCR_TEXT, [lessonId, teacherId])).rows[0],

    // Transaction: insert the lesson, insert its mark-scheme OCR, link them.
    // Self-contained (owns its client), so it doesn't take an executor.
    createLesson: async (lessonTitle, classId, fileName, mimeType, ocrText) => {
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const { rows: [lesson] } = await client.query(
                'INSERT INTO lessons (lesson_title, class_id, mark_scheme_file_name, mark_scheme_mime_type) VALUES ($1, $2, $3, $4) RETURNING id',
                [lessonTitle, classId, fileName, mimeType]
            )
            const { rows: [ocr] } = await client.query(
                'INSERT INTO teacher_ocr (lesson_id, ocr_text) VALUES ($1, $2) RETURNING id',
                [lesson.id, ocrText]
            )
            await client.query('UPDATE lessons SET mark_scheme_ocr = $1 WHERE id = $2', [ocr.id, lesson.id])
            await client.query('COMMIT')
            return lesson.id
        } catch (err) {
            await client.query('ROLLBACK')
            throw err
        } finally {
            client.release()
        }
    },
}

// ── Least-privilege accessor for the classes flow only. ──
// Every read/write method accepts an optional executor `e` (the pool by default,
// or a transaction client) so it can run inside classDb.transaction.
export const classDb = {
    listClasses: async (teacherId, e = pool) => (await exec(e, `
        SELECT c.id, c.class_name, c.year_group_id, COUNT(s.id)::int AS student_count
        FROM classes c
        LEFT JOIN students s ON s.class_id = c.id
        WHERE c.teacher_id = $1
        GROUP BY c.id
        ORDER BY c.class_name
    `, [teacherId])).rows,

    findClassById:            async (classId, teacherId, e = pool) =>
        (await exec(e, 'SELECT id, class_name, year_group_id FROM classes WHERE id = $1 AND teacher_id = $2', [classId, teacherId])).rows[0],
    findClassByName:          async (className, teacherId, e = pool) =>
        (await exec(e, 'SELECT id FROM classes WHERE class_name = $1 AND teacher_id = $2', [className, teacherId])).rows[0],
    findClassByNameExcluding: async (className, teacherId, classId, e = pool) =>
        (await exec(e, 'SELECT id FROM classes WHERE class_name = $1 AND teacher_id = $2 AND id != $3', [className, teacherId, classId])).rows[0],
    validateYear:             async (yearId, e = pool) =>
        (await exec(e, 'SELECT id FROM year_groups WHERE id = $1', [yearId])).rows[0],
    insertClass:              async (className, yearGroupId, teacherId, e = pool) =>
        (await exec(e, 'INSERT INTO classes (class_name, year_group_id, teacher_id) VALUES ($1, $2, $3) RETURNING id', [className, yearGroupId, teacherId])).rows[0],
    updateClass:              async (className, yearGroupId, classId, e = pool) =>
        exec(e, 'UPDATE classes SET class_name = $1, year_group_id = $2 WHERE id = $3', [className, yearGroupId, classId]),

    listStudents:               async (classId, e = pool) =>
        (await exec(e, 'SELECT id, student_name FROM students WHERE class_id = $1 ORDER BY student_name', [classId])).rows,
    findStudentByName:          async (studentName, classId, e = pool) =>
        (await exec(e, 'SELECT id FROM students WHERE student_name = $1 AND class_id = $2', [studentName, classId])).rows[0],
    findStudentByNameExcluding: async (studentName, classId, studentId, e = pool) =>
        (await exec(e, 'SELECT id FROM students WHERE student_name = $1 AND class_id = $2 AND id != $3', [studentName, classId, studentId])).rows[0],
    findStudentById:            async (studentId, classId, e = pool) =>
        (await exec(e, 'SELECT id FROM students WHERE id = $1 AND class_id = $2', [studentId, classId])).rows[0],
    insertStudent:              async (studentName, classId, e = pool) =>
        (await exec(e, 'INSERT INTO students (student_name, class_id) VALUES ($1, $2) RETURNING id', [studentName, classId])).rows[0],
    updateStudent:              async (studentName, studentId, e = pool) =>
        exec(e, 'UPDATE students SET student_name = $1 WHERE id = $2', [studentName, studentId]),

    // Transaction: delete a student plus their derived rows, in FK-safe order.
    // Self-contained (owns its client).
    deleteStudent: async (studentId) => {
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            await client.query('DELETE FROM marking_results WHERE student_id = $1', [studentId])
            await client.query('DELETE FROM student_ocr WHERE file_id IN (SELECT id FROM student_files WHERE student_id = $1)', [studentId])
            await client.query('DELETE FROM student_files WHERE student_id = $1', [studentId])
            await client.query('DELETE FROM students WHERE id = $1', [studentId])
            await client.query('COMMIT')
        } catch (err) {
            await client.query('ROLLBACK')
            throw err
        } finally {
            client.release()
        }
    },

    // Generic transaction wrapper: runs fn on a single dedicated client with
    // BEGIN/COMMIT (ROLLBACK on throw). fn receives the client to pass as the
    // `e` executor into the accessor methods above, so all of fn's queries run
    // on the same transactional connection.
    transaction: async (fn) => {
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const result = await fn(client)
            await client.query('COMMIT')
            return result
        } catch (err) {
            await client.query('ROLLBACK')
            throw err
        } finally {
            client.release()
        }
    },
}
