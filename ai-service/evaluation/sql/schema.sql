IF NOT EXISTS (
    SELECT 1
    FROM sys.schemas
    WHERE name = N'evaluation'
)
BEGIN
    EXEC(N'CREATE SCHEMA evaluation AUTHORIZATION dbo');
END;
GO

/* The stable definition of what an evaluation is assessing. */
IF OBJECT_ID(N'evaluation.targets', N'U') IS NULL
BEGIN
    CREATE TABLE evaluation.targets (
        target_id   BIGINT         IDENTITY(1,1) NOT NULL,
        target_key  NVARCHAR(100)  NOT NULL,
        name        NVARCHAR(255)  NOT NULL,
        description NVARCHAR(MAX)  NULL,
        created_at  DATETIME2(3)   NOT NULL
            CONSTRAINT DF_evaluation_targets_created_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_evaluation_targets PRIMARY KEY (target_id),
        CONSTRAINT UQ_evaluation_targets_target_key UNIQUE (target_key)
    );
END;
GO

/* Frozen prompt inputs and their expected target-specific result. */
IF OBJECT_ID(N'evaluation.datasets', N'U') IS NULL
BEGIN
    CREATE TABLE evaluation.datasets (
        dataset_id          BIGINT         IDENTITY(1,1) NOT NULL,
        target_id           BIGINT         NOT NULL,
        name                NVARCHAR(255)  NOT NULL,
        version             INT            NOT NULL
            CONSTRAINT DF_evaluation_datasets_version DEFAULT (1),
        input_data_json     NVARCHAR(MAX)  NOT NULL,
        expected_result_json NVARCHAR(MAX) NULL,
        dataset_hash        CHAR(64)       NOT NULL,
        created_at          DATETIME2(3)   NOT NULL
            CONSTRAINT DF_evaluation_datasets_created_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_evaluation_datasets PRIMARY KEY (dataset_id),
        CONSTRAINT FK_evaluation_datasets_target FOREIGN KEY (target_id)
            REFERENCES evaluation.targets(target_id),
        CONSTRAINT UQ_evaluation_datasets_target_name_version
            UNIQUE (target_id, name, version),
        CONSTRAINT UQ_evaluation_datasets_target_dataset
            UNIQUE (target_id, dataset_id)
    );
END;
GO

/* Read-only snapshots of prompts integrated in the Python service. */
IF OBJECT_ID(N'evaluation.prompts', N'U') IS NULL
BEGIN
    CREATE TABLE evaluation.prompts (
        prompt_id    BIGINT         IDENTITY(1,1) NOT NULL,
        target_id    BIGINT         NOT NULL,
        name         NVARCHAR(255)  NOT NULL,
        version      INT            NOT NULL,
        prompt_json  NVARCHAR(MAX)  NOT NULL,
        prompt_hash  CHAR(64)       NOT NULL,
        change_notes NVARCHAR(MAX)  NULL,
        created_at   DATETIME2(3)   NOT NULL
            CONSTRAINT DF_evaluation_prompts_created_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_evaluation_prompts PRIMARY KEY (prompt_id),
        CONSTRAINT FK_evaluation_prompts_target FOREIGN KEY (target_id)
            REFERENCES evaluation.targets(target_id),
        CONSTRAINT UQ_evaluation_prompts_target_name_version
            UNIQUE (target_id, name, version),
        CONSTRAINT UQ_evaluation_prompts_target_prompt
            UNIQUE (target_id, prompt_id)
    );
END;
GO

/* One repeatable experiment: one target, dataset, prompt and run count. */
IF OBJECT_ID(N'evaluation.evaluations', N'U') IS NULL
BEGIN
    CREATE TABLE evaluation.evaluations (
        evaluation_id  BIGINT         IDENTITY(1,1) NOT NULL,
        target_id      BIGINT         NOT NULL,
        dataset_id     BIGINT         NOT NULL,
        prompt_id      BIGINT         NOT NULL,
        name           NVARCHAR(255)  NOT NULL,
        status         NVARCHAR(30)   NOT NULL
            CONSTRAINT DF_evaluation_evaluations_status DEFAULT N'pending',
        requested_runs INT            NOT NULL,
        model_requested NVARCHAR(100) NOT NULL,
        temperature    DECIMAL(4,3)   NOT NULL
            CONSTRAINT DF_evaluation_evaluations_temperature DEFAULT (0),
        started_at     DATETIME2(3)   NULL,
        completed_at   DATETIME2(3)   NULL,
        created_at     DATETIME2(3)   NOT NULL
            CONSTRAINT DF_evaluation_evaluations_created_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_evaluation_evaluations PRIMARY KEY (evaluation_id),
        CONSTRAINT FK_evaluation_evaluations_dataset_target
            FOREIGN KEY (target_id, dataset_id)
            REFERENCES evaluation.datasets(target_id, dataset_id),
        CONSTRAINT FK_evaluation_evaluations_prompt_target
            FOREIGN KEY (target_id, prompt_id)
            REFERENCES evaluation.prompts(target_id, prompt_id)
    );
END;
GO

/* One row for each repetition performed by an evaluation. */
IF OBJECT_ID(N'evaluation.results', N'U') IS NULL
BEGIN
    CREATE TABLE evaluation.results (
        result_id         BIGINT         IDENTITY(1,1) NOT NULL,
        evaluation_id     BIGINT         NOT NULL,
        run_number        INT            NOT NULL,
        status            NVARCHAR(30)   NOT NULL,
        actual_result_json NVARCHAR(MAX) NULL,
        comparison_json   NVARCHAR(MAX)  NULL,
        error_message     NVARCHAR(MAX)  NULL,
        created_at        DATETIME2(3)   NOT NULL
            CONSTRAINT DF_evaluation_results_created_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_evaluation_results PRIMARY KEY (result_id),
        CONSTRAINT FK_evaluation_results_evaluation FOREIGN KEY (evaluation_id)
            REFERENCES evaluation.evaluations(evaluation_id),
        CONSTRAINT UQ_evaluation_results_evaluation_run
            UNIQUE (evaluation_id, run_number)
    );
END;
GO

/* One provider-performance record for each result. */
IF OBJECT_ID(N'evaluation.performance', N'U') IS NULL
BEGIN
    CREATE TABLE evaluation.performance (
        performance_id   BIGINT         IDENTITY(1,1) NOT NULL,
        result_id        BIGINT         NOT NULL,
        model_returned   NVARCHAR(100)  NULL,
        finish_reason    NVARCHAR(50)   NULL,
        duration_ms      BIGINT         NULL,
        prompt_tokens    INT            NULL,
        completion_tokens INT           NULL,
        total_tokens     INT            NULL,
        created_at       DATETIME2(3)   NOT NULL
            CONSTRAINT DF_evaluation_performance_created_at DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_evaluation_performance PRIMARY KEY (performance_id),
        CONSTRAINT FK_evaluation_performance_result FOREIGN KEY (result_id)
            REFERENCES evaluation.results(result_id),
        CONSTRAINT UQ_evaluation_performance_result UNIQUE (result_id)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'evaluation.evaluations')
      AND name = N'IX_evaluation_evaluations_target'
)
BEGIN
    CREATE INDEX IX_evaluation_evaluations_target
        ON evaluation.evaluations(target_id, created_at);
END;
GO
