// Prints a JSON snapshot of dbo.api_usage, aggregated for the cost/usage
// dashboard artifact. Run on request (no scheduling) — re-run this whenever
// the dashboard needs fresh numbers:
//
//   node backend/scripts/usage-report.mjs
//
import { pool, poolConnect } from '../src/db/index.js'

await poolConnect

const [totals, byType, byDay, byLesson, recent] = await Promise.all([
    pool.request().query(`
        SELECT
            COUNT(*)                    AS call_count,
            SUM(total_tokens)           AS total_tokens,
            SUM(estimated_cost_usd)     AS total_cost_usd,
            MIN(created_at)             AS first_call_at,
            MAX(created_at)             AS last_call_at
        FROM dbo.api_usage
    `),
    pool.request().query(`
        SELECT
            call_type,
            COUNT(*)                AS call_count,
            SUM(total_tokens)       AS total_tokens,
            SUM(estimated_cost_usd) AS total_cost_usd
        FROM dbo.api_usage
        GROUP BY call_type
        ORDER BY total_cost_usd DESC
    `),
    pool.request().query(`
        SELECT
            CONVERT(VARCHAR(10), created_at, 120) AS day,
            call_type,
            COUNT(*)                AS call_count,
            SUM(estimated_cost_usd) AS total_cost_usd
        FROM dbo.api_usage
        GROUP BY CONVERT(VARCHAR(10), created_at, 120), call_type
        ORDER BY day ASC
    `),
    pool.request().query(`
        SELECT TOP 15
            l.id                     AS lesson_id,
            l.lesson_title,
            COUNT(*)                 AS call_count,
            SUM(u.estimated_cost_usd) AS total_cost_usd
        FROM dbo.api_usage u
        JOIN dbo.lessons l ON l.id = u.lesson_id
        GROUP BY l.id, l.lesson_title
        ORDER BY total_cost_usd DESC
    `),
    pool.request().query(`
        SELECT TOP 25
            u.id, u.call_type, u.lesson_id, u.student_id,
            u.prompt_tokens, u.completion_tokens, u.total_tokens,
            u.estimated_cost_usd, u.created_at,
            l.lesson_title, s.student_name
        FROM dbo.api_usage u
        LEFT JOIN dbo.lessons l  ON l.id = u.lesson_id
        LEFT JOIN dbo.students s ON s.id = u.student_id
        ORDER BY u.created_at DESC
    `),
])

console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    totals: totals.recordset[0],
    by_call_type: byType.recordset,
    by_day: byDay.recordset,
    by_lesson: byLesson.recordset,
    recent_calls: recent.recordset,
}, null, 2))

await pool.close()
