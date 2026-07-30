// Builds the full PostgreSQL schema: creates every table (idempotent via
// IF NOT EXISTS), seeds the read-only year_groups reference data, and installs
// the read-only triggers. Called by server.js right after the pool is created
// and BEFORE any query runs, so a fresh database has its tables in place.
//
// `db` is a node-postgres Pool (or client): every statement runs via db.query
// and is awaited.
//
// Notes on the SQLite -> Postgres port:
//   - INTEGER PRIMARY KEY AUTOINCREMENT  ->  INTEGER GENERATED ALWAYS AS IDENTITY
//   - DEFAULT (datetime('now'))          ->  TEXT default via to_char(now()...),
//     kept as TEXT in the same 'YYYY-MM-DD HH:MM:SS' UTC format SQLite produced,
//     so the frontend receives identical timestamp strings (no UI change).
//   - Tables are created in dependency order (Postgres validates FK targets at
//     CREATE time, unlike SQLite) — lessons before student_files, etc.
export async function initSchema(db) {
    // ── Reference table ───────────────────────────────────────────────────────
    // Explicit ids (7–11), so no IDENTITY here.
    await db.query(`
        CREATE TABLE IF NOT EXISTS year_groups (
            id    INTEGER PRIMARY KEY,
            label TEXT    NOT NULL UNIQUE
        );
    `)

    // Seed only when empty. We use a count check (not ON CONFLICT) because the
    // read-only triggers installed below would otherwise block the seed INSERT
    // on every subsequent boot.
    const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM year_groups')
    if (rows[0].count === 0) {
        await db.query(`
            INSERT INTO year_groups (id, label) VALUES
                (7,  'Year 7'),
                (8,  'Year 8'),
                (9,  'Year 9'),
                (10, 'Year 10'),
                (11, 'Year 11');
        `)
    }

    // Read-only triggers — installed AFTER the seed so they don't block it.
    // CREATE OR REPLACE TRIGGER is Postgres 14+ (idempotent across boots).
    await db.query(`
        CREATE OR REPLACE FUNCTION year_groups_readonly() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'year_groups is a read-only reference table';
        END;
        $$;
    `)
    await db.query(`
        CREATE OR REPLACE TRIGGER year_groups_no_insert
            BEFORE INSERT ON year_groups
            FOR EACH ROW EXECUTE FUNCTION year_groups_readonly();
    `)
    await db.query(`
        CREATE OR REPLACE TRIGGER year_groups_no_update
            BEFORE UPDATE ON year_groups
            FOR EACH ROW EXECUTE FUNCTION year_groups_readonly();
    `)
    await db.query(`
        CREATE OR REPLACE TRIGGER year_groups_no_delete
            BEFORE DELETE ON year_groups
            FOR EACH ROW EXECUTE FUNCTION year_groups_readonly();
    `)

    // ── Teacher table ─────────────────────────────────────────────────────────
    // email_hash: HMAC-SHA256 of the lowercased email — never stores the raw address.
    // password_hash: bcrypt hash of the peppered password.
    await db.query(`
        CREATE TABLE IF NOT EXISTS teachers (
            id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name          TEXT NOT NULL,
            email_hash    TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        );
    `)

    // ── Class and student tables ──────────────────────────────────────────────
    // classes.year_group_id  — a class belongs to exactly one year.
    // classes.teacher_id     — a class belongs to exactly one teacher.
    // students.class_id      — a student belongs to exactly one class.
    await db.query(`
        CREATE TABLE IF NOT EXISTS classes (
            id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            class_name    TEXT    NOT NULL,
            year_group_id INTEGER NOT NULL REFERENCES year_groups(id),
            teacher_id    INTEGER NOT NULL REFERENCES teachers(id)
        );
    `)
    await db.query(`
        CREATE TABLE IF NOT EXISTS students (
            id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            student_name TEXT    NOT NULL,
            class_id     INTEGER NOT NULL REFERENCES classes(id)
        );
    `)

    // ── Lessons ────────────────────────────────────────────────────────────────
    // question: the text of the exam question the teacher entered when creating
    //   the lesson — passed to the LLM alongside the mark scheme.
    // Created before student_files (which references lessons) — Postgres validates
    // the FK target at CREATE time, so order matters.
    await db.query(`
        CREATE TABLE IF NOT EXISTS lessons (
            id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            lesson_title          TEXT    NOT NULL,
            class_id              INTEGER NOT NULL REFERENCES classes(id),
            mark_scheme_file_name TEXT    NOT NULL,
            mark_scheme_mime_type TEXT    NOT NULL,
            mark_scheme_ocr       INTEGER,
            created_at            TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'),
            question              TEXT    NOT NULL DEFAULT ''
        );
    `)

    // ── File and OCR tables ────────────────────────────────────────────────────
    await db.query(`
        CREATE TABLE IF NOT EXISTS student_files (
            id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            student_id  INTEGER NOT NULL REFERENCES students(id),
            lesson_id   INTEGER NOT NULL REFERENCES lessons(id),
            file_name   TEXT    NOT NULL,
            mime_type   TEXT    NOT NULL,
            uploaded_at TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        );
    `)
    await db.query(`
        CREATE TABLE IF NOT EXISTS student_ocr (
            id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            file_id  INTEGER NOT NULL UNIQUE REFERENCES student_files(id),
            ocr_text TEXT    NOT NULL,
            ocr_at   TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        );
    `)

    // ── Lesson OCR and marking tables ──────────────────────────────────────────
    // teacher_ocr.structured_scheme: LLM-parsed JSON of the mark scheme extracted
    //   during lesson creation (Call 1 in the two-call LLM pipeline).
    // teacher_ocr.selected_question_index: which question the teacher picked when
    //   the mark scheme contains multiple questions (multi-question papers).
    // marking_results — one row per student per lesson; UNIQUE(lesson_id, student_id)
    //   prevents a student being graded twice in the same lesson.
    await db.query(`
        CREATE TABLE IF NOT EXISTS teacher_ocr (
            id                      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            lesson_id               INTEGER NOT NULL REFERENCES lessons(id),
            ocr_text                TEXT    NOT NULL,
            created_at              TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'),
            structured_scheme       TEXT    NOT NULL DEFAULT '',
            selected_question_index INTEGER DEFAULT NULL
        );
    `)
    await db.query(`
        CREATE TABLE IF NOT EXISTS marking_results (
            id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            lesson_id     INTEGER NOT NULL REFERENCES lessons(id),
            student_id    INTEGER NOT NULL REFERENCES students(id),
            ocr_id        INTEGER NOT NULL UNIQUE REFERENCES student_ocr(id),
            student_grade TEXT    NOT NULL,
            marked_at     TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'),
            UNIQUE (lesson_id, student_id)
        );
    `)

    // ── Teacher correction / Human-in-the-Loop table ──────────────────────────
    // Captures every time a teacher accepts or overrides the LLM's mark.
    // Used to compute Cohen's Kappa (inter-rater reliability between LLM and teacher)
    // and to feed teacher corrections back into the RAG exemplar system (RLHF loop).
    //
    // result_id          → marking_results.id  (which student/lesson this corrects)
    // teacher_id         → teachers.id         (audit trail: which teacher intervened)
    // llm_score          → the raw score the LLM gave before teacher review
    // teacher_correction → NULL if teacher accepted the mark unchanged; otherwise
    //                      the number the teacher typed in (may differ from new_score
    //                      if further validation logic is added later)
    // new_score          → the final score stored after the teacher's decision
    //                      (equals llm_score when teacher accepts; equals
    //                      teacher_correction when teacher overrides)
    await db.query(`
        CREATE TABLE IF NOT EXISTS mark_corrections (
            id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            result_id           INTEGER NOT NULL REFERENCES marking_results(id),
            teacher_id          INTEGER NOT NULL REFERENCES teachers(id),
            llm_score           INTEGER NOT NULL,
            teacher_correction  INTEGER,
            new_score           INTEGER NOT NULL,
            corrected_at        TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        );
    `)
}
