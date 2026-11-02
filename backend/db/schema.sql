/* ============================================================================
   Klassio — Azure SQL (T-SQL) schema
   ----------------------------------------------------------------------------
   Apply ONCE, as the Entra admin of the SQL server, using a tool that
   understands GO batch separators (Azure Data Studio, sqlcmd -G, or the portal
   Query editor). The runtime app connects with its managed identity and
   read/write only — it NEVER runs this DDL.

   Azure SQL implementation notes:
     - INTEGER GENERATED ALWAYS AS IDENTITY   ->  INT IDENTITY(1,1)
     - TEXT                                   ->  NVARCHAR(n) / NVARCHAR(MAX)
     - CREATE TABLE IF NOT EXISTS             ->  IF OBJECT_ID(...) IS NULL
     - to_char(now() AT TIME ZONE 'UTC', ...) default  ->
         CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120)  — the SAME
         'YYYY-MM-DD HH:MM:SS' UTC text the frontend already expects.
     - Read-only reference data is protected by INSTEAD OF triggers that THROW
   Idempotent: safe to re-run (tables guarded by IF NOT EXISTS, seed by a count
   check, triggers by CREATE OR ALTER).
   ============================================================================ */

/* ---- Reference table: year_groups (explicit ids 7-11, read-only) ---------- */
IF OBJECT_ID(N'dbo.year_groups', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.year_groups (
        id    INT          NOT NULL PRIMARY KEY,   -- explicit ids, no IDENTITY
        label NVARCHAR(50) NOT NULL UNIQUE
    );
END;
GO

-- Seed BEFORE the read-only triggers exist (they would otherwise block it).
IF NOT EXISTS (SELECT 1 FROM dbo.year_groups)
BEGIN
    INSERT INTO dbo.year_groups (id, label) VALUES
        (7,  N'Year 7'),
        (8,  N'Year 8'),
        (9,  N'Year 9'),
        (10, N'Year 10'),
        (11, N'Year 11');
END;
GO

-- Read-only guards: block every write to year_groups (INSTEAD OF ... THROW).
CREATE OR ALTER TRIGGER dbo.year_groups_no_insert
    ON dbo.year_groups INSTEAD OF INSERT
AS
    THROW 50000, 'year_groups is a read-only reference table', 1;
GO
CREATE OR ALTER TRIGGER dbo.year_groups_no_update
    ON dbo.year_groups INSTEAD OF UPDATE
AS
    THROW 50000, 'year_groups is a read-only reference table', 1;
GO
CREATE OR ALTER TRIGGER dbo.year_groups_no_delete
    ON dbo.year_groups INSTEAD OF DELETE
AS
    THROW 50000, 'year_groups is a read-only reference table', 1;
GO

/* ---- Teachers ------------------------------------------------------------- */
-- email_hash: HMAC-SHA256 hex (64 chars). password_hash: bcrypt (60 chars).
IF OBJECT_ID(N'dbo.teachers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.teachers (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        name          NVARCHAR(100) NOT NULL,
        email_hash    NVARCHAR(64)  NOT NULL UNIQUE,
        password_hash NVARCHAR(100) NOT NULL,
        created_at    NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_teachers_created_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120))
    );
END;
GO

/* ---- Classes & students --------------------------------------------------- */
IF OBJECT_ID(N'dbo.classes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.classes (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        class_name    NVARCHAR(100) NOT NULL,
        year_group_id INT           NOT NULL REFERENCES dbo.year_groups(id),
        teacher_id    INT           NOT NULL REFERENCES dbo.teachers(id)
    );
END;
GO

IF OBJECT_ID(N'dbo.students', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.students (
        id           INT           IDENTITY(1,1) PRIMARY KEY,
        student_name NVARCHAR(100) NOT NULL,
        class_id     INT           NOT NULL REFERENCES dbo.classes(id)
    );
END;
GO

/* ---- Lessons -------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.lessons', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.lessons (
        id                    INT           IDENTITY(1,1) PRIMARY KEY,
        lesson_title          NVARCHAR(255) NOT NULL,
        class_id              INT           NOT NULL REFERENCES dbo.classes(id),
        mark_scheme_file_name NVARCHAR(255) NOT NULL,
        mark_scheme_mime_type NVARCHAR(100) NOT NULL,
        mark_scheme_ocr       INT           NULL,
        created_at            NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_lessons_created_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120))
    );
END;
GO

/* ---- File & OCR tables ---------------------------------------------------- */
IF OBJECT_ID(N'dbo.student_files', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.student_files (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        student_id  INT           NOT NULL REFERENCES dbo.students(id),
        lesson_id   INT           NOT NULL REFERENCES dbo.lessons(id),
        file_name   NVARCHAR(255) NOT NULL,
        mime_type   NVARCHAR(100) NOT NULL,
        uploaded_at NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_student_files_uploaded_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120))
    );
END;
GO

IF OBJECT_ID(N'dbo.student_ocr', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.student_ocr (
        id       INT           IDENTITY(1,1) PRIMARY KEY,
        file_id  INT           NOT NULL UNIQUE REFERENCES dbo.student_files(id),
        ocr_text NVARCHAR(MAX) NOT NULL,
        ocr_at   NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_student_ocr_ocr_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120))
    );
END;
GO

/* ---- Lesson OCR & marking ------------------------------------------------- */
IF OBJECT_ID(N'dbo.teacher_ocr', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.teacher_ocr (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        lesson_id  INT           NOT NULL REFERENCES dbo.lessons(id),
        ocr_text   NVARCHAR(MAX) NOT NULL,
        created_at NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_teacher_ocr_created_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120))
    );
END;
GO

-- Added later: holds the LLM-extracted {paper_type, questions[]} JSON produced
-- once per mark scheme upload, so per-student marking calls can reuse it
-- instead of re-extracting. ALTER, not part of CREATE TABLE above, because
-- IF OBJECT_ID(...) IS NULL only guards table creation — it has no effect on
-- a table that already exists live, so this needs its own guard.
IF COL_LENGTH('dbo.teacher_ocr', 'structured_scheme') IS NULL
BEGIN
    ALTER TABLE dbo.teacher_ocr
        ADD structured_scheme NVARCHAR(MAX) NOT NULL
            CONSTRAINT DF_teacher_ocr_structured_scheme DEFAULT N'';
END;
GO

-- Stores the descriptor-thread structure produced after mark-scheme
-- extraction. It is retained separately from structured_scheme so later
-- paragraph-level analysis can reuse it without re-running enrichment.
IF COL_LENGTH('dbo.teacher_ocr', 'thread_extraction') IS NULL
BEGIN
    ALTER TABLE dbo.teacher_ocr
        ADD thread_extraction NVARCHAR(MAX) NOT NULL
            CONSTRAINT DF_teacher_ocr_thread_extraction DEFAULT N'';
END;
GO

-- Added later: which question (index into structured_scheme's questions[])
-- the teacher picked, for multi-question papers. NULL until they choose —
-- single-question papers never need this set at all.
IF COL_LENGTH('dbo.teacher_ocr', 'selected_question_index') IS NULL
BEGIN
    ALTER TABLE dbo.teacher_ocr
        ADD selected_question_index INT NULL;
END;
GO

-- Added later: the question wording the teacher confirmed for the selected
-- question. Essay questions are often printed only on the question paper,
-- not the mark scheme, so extraction can't be relied on to find them; the
-- teacher confirms (or pastes) it before marking. NULL on lessons created
-- before this existed -- marking falls back to the scheme's short summary.
IF COL_LENGTH('dbo.teacher_ocr', 'confirmed_question_text') IS NULL
BEGIN
    ALTER TABLE dbo.teacher_ocr
        ADD confirmed_question_text NVARCHAR(2000) NULL;
END;
GO

/* ---- Asynchronous marking jobs ------------------------------------------ */
-- One row represents one attempt to mark one student's work. Service Bus
-- delivers the work, while this table is the durable application-level source
-- of truth used by the worker and the authenticated frontend status route.
IF OBJECT_ID(N'dbo.marking_jobs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.marking_jobs (
        job_id        UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_marking_jobs_job_id DEFAULT (NEWID()),
        teacher_id    INT              NOT NULL REFERENCES dbo.teachers(id),
        lesson_id     INT              NOT NULL REFERENCES dbo.lessons(id),
        student_id    INT              NOT NULL REFERENCES dbo.students(id),
        status        NVARCHAR(20)     NOT NULL,
        queued_at     DATETIME2(3)     NOT NULL
            CONSTRAINT DF_marking_jobs_queued_at DEFAULT (SYSUTCDATETIME()),
        processing_at DATETIME2(3)     NULL,
        marking_at    DATETIME2(3)     NULL,
        completed_at  DATETIME2(3)     NULL,
        updated_at    DATETIME2(3)     NOT NULL
            CONSTRAINT DF_marking_jobs_updated_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_marking_jobs PRIMARY KEY (job_id),
        CONSTRAINT CK_marking_jobs_status
            CHECK (status IN (N'queued', N'processing', N'marking', N'complete'))
    );
END;
GO

-- Supports the lesson-level status check and selecting the newest attempt for
-- each student without scanning the full job history.
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_marking_jobs_lesson_teacher_student_queued'
      AND object_id = OBJECT_ID(N'dbo.marking_jobs')
)
BEGIN
    CREATE INDEX IX_marking_jobs_lesson_teacher_student_queued
        ON dbo.marking_jobs (lesson_id, teacher_id, student_id, queued_at DESC);
END;
GO

-- UNIQUE(lesson_id, student_id): a student can't be graded twice in one lesson.
IF OBJECT_ID(N'dbo.marking_results', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.marking_results (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        lesson_id     INT           NOT NULL REFERENCES dbo.lessons(id),
        student_id    INT           NOT NULL REFERENCES dbo.students(id),
        ocr_id        INT           NOT NULL UNIQUE REFERENCES dbo.student_ocr(id),
        student_grade NVARCHAR(MAX) NOT NULL,
        aggregation_result NVARCHAR(MAX) NULL,
        final_result NVARCHAR(MAX) NULL,
        marked_at     NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_marking_results_marked_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120)),
        CONSTRAINT UQ_marking_lesson_student UNIQUE (lesson_id, student_id)
    );
END;
GO

IF COL_LENGTH(N'dbo.marking_results', N'aggregation_result') IS NULL
BEGIN
    ALTER TABLE dbo.marking_results
    ADD aggregation_result NVARCHAR(MAX) NULL;
END;
GO

IF COL_LENGTH(N'dbo.marking_results', N'final_result') IS NULL
BEGIN
    ALTER TABLE dbo.marking_results
    ADD final_result NVARCHAR(MAX) NULL;
END;
GO

-- A teacher's review of one marked essay. Holds a snapshot of what the engine
-- gave (so a review survives the essay being re-marked: re-marking deletes and
-- re-inserts the marking_results row, which sets marking_result_id to NULL
-- here rather than blocking or deleting the review). Never stores essay text.
-- review_mode 'blind': the teacher chose a level before seeing the
-- suggestion; those reviews are a held-out accuracy check and are kept out of
-- calibration.
IF OBJECT_ID(N'dbo.mark_reviews', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.mark_reviews (
        id                     INT           IDENTITY(1,1) PRIMARY KEY,
        marking_result_id      INT           NULL REFERENCES dbo.marking_results(id) ON DELETE SET NULL,
        lesson_id              INT           NOT NULL REFERENCES dbo.lessons(id),
        student_id             INT           NOT NULL REFERENCES dbo.students(id),
        teacher_id             INT           NOT NULL REFERENCES dbo.teachers(id),
        review_mode            NVARCHAR(10)  NOT NULL
            CONSTRAINT CK_mark_reviews_mode CHECK (review_mode IN (N'normal', N'blind')),
        outcome                NVARCHAR(10)  NOT NULL
            CONSTRAINT CK_mark_reviews_outcome CHECK (outcome IN (N'confirmed', N'changed')),
        scheme_key             NVARCHAR(32)  NULL,
        engine_combine_mode    NVARCHAR(20)  NULL,
        engine_runs_per_thread INT           NULL,
        engine_fine_score      DECIMAL(6,3)  NULL,
        engine_level           INT           NULL,
        engine_mark            INT           NOT NULL,
        engine_max_mark        INT           NOT NULL,
        engine_marked_at       NVARCHAR(30)  NOT NULL,
        teacher_level          INT           NOT NULL,
        teacher_mark           INT           NULL,
        reason_codes           NVARCHAR(200) NULL,
        seconds_spent          INT           NULL,
        reviewed_at            NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_mark_reviews_reviewed_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120))
    );
END;
GO

-- One review per current marking result. Filtered, because reviews of
-- earlier (since re-marked) results all have a NULL marking_result_id.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_mark_reviews_marking_result' AND object_id = OBJECT_ID(N'dbo.mark_reviews')
)
BEGIN
    CREATE UNIQUE INDEX UX_mark_reviews_marking_result
        ON dbo.mark_reviews (marking_result_id) WHERE marking_result_id IS NOT NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_mark_reviews_lesson_student' AND object_id = OBJECT_ID(N'dbo.mark_reviews')
)
BEGIN
    CREATE INDEX IX_mark_reviews_lesson_student ON dbo.mark_reviews (lesson_id, student_id);
END;
GO

-- Essays picked at random for a blind check, chosen once per lesson. Keyed by
-- student (not marking result) so a pick survives the essay being re-marked.
IF OBJECT_ID(N'dbo.review_blind_picks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.review_blind_picks (
        id         INT          IDENTITY(1,1) PRIMARY KEY,
        lesson_id  INT          NOT NULL REFERENCES dbo.lessons(id),
        student_id INT          NOT NULL REFERENCES dbo.students(id),
        picked_at  NVARCHAR(30) NOT NULL
            CONSTRAINT DF_review_blind_picks_picked_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120)),
        CONSTRAINT UQ_review_blind_picks UNIQUE (lesson_id, student_id)
    );
END;
GO

/* ============================================================================
   AFTER the schema exists, grant the app's managed identity READ/WRITE only
   (run once, as admin). Replace <backend-container-app-name> with the backend
   Container App's resource name. NO DDL rights are granted — the app can never
   create/alter tables.
   ----------------------------------------------------------------------------
   CREATE USER [<backend-container-app-name>] FROM EXTERNAL PROVIDER;
   ALTER ROLE db_datareader ADD MEMBER [<backend-container-app-name>];
   ALTER ROLE db_datawriter ADD MEMBER [<backend-container-app-name>];
   ============================================================================ */
