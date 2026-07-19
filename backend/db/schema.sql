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

-- UNIQUE(lesson_id, student_id): a student can't be graded twice in one lesson.
IF OBJECT_ID(N'dbo.marking_results', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.marking_results (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        lesson_id     INT           NOT NULL REFERENCES dbo.lessons(id),
        student_id    INT           NOT NULL REFERENCES dbo.students(id),
        ocr_id        INT           NOT NULL UNIQUE REFERENCES dbo.student_ocr(id),
        student_grade NVARCHAR(MAX) NOT NULL,
        marked_at     NVARCHAR(30)  NOT NULL
            CONSTRAINT DF_marking_results_marked_at DEFAULT (CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120)),
        CONSTRAINT UQ_marking_lesson_student UNIQUE (lesson_id, student_id)
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
