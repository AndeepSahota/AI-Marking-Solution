import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestAccount } from './helpers/testAccount.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MARK_SCHEME_PDF = path.join(__dirname, 'fixtures', 'mark-scheme.pdf')
const RESPONSE_PDF = path.join(__dirname, 'fixtures', 'response-A.pdf')

// This is a shape/functional check, not a behavioural-accuracy check: it
// confirms the whole pipeline runs end-to-end and produces a well-formed
// result, not that the AI's mark matches the official grade for response-A
// (that's scripts/batch_eval.py's job, against the same exemplar). A real
// OpenAI + Datalab OCR call happens here — this spends real API credits
// every run, by design (same "verify with a real call" approach as the
// rest of this project's testing).
test('teacher can log in, upload a mark scheme, mark a student, and see feedback', async ({ page, request }) => {
    const account = await createTestAccount(request)

    await page.goto('/login')
    await page.getByLabel('Email address').fill(account.email)
    await page.getByLabel('Password').fill(account.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await page.waitForURL('/')

    await page.locator('select.home-class-select').selectOption({ label: account.className })
    await page.locator('input[type="file"]').setInputFiles(MARK_SCHEME_PDF)
    await page.getByRole('button', { name: 'Begin marking' }).click()

    // OCR + mark-scheme extraction — real API call, can take a while.
    await page.waitForURL(/\/(select-question|student-marking)\/\d+/, { timeout: 60_000 })

    // Q5 is a single-question scheme, so it should land straight on
    // student-marking. If a mark scheme with multiple questions is ever used
    // here instead, this is the point that would need a question-picker step.
    await expect(page).toHaveURL(/\/student-marking\/\d+/)

    const studentRow = page.locator('.student-marking-row', { hasText: account.studentName })
    await expect(studentRow).toBeVisible()
    await studentRow.getByRole('button', { name: 'Upload work' }).click()
    await page.locator('input[type="file"]').setInputFiles(RESPONSE_PDF)

    // Real marking call (self-consistency, n=3 samples) — the slow step.
    await expect(studentRow.locator('.student-result-score')).toBeVisible({ timeout: 90_000 })
    await expect(studentRow.locator('.student-result-score')).toHaveText(/\d+\/\d+/)

    await studentRow.getByRole('button', { name: 'View feedback' }).click()
    await page.waitForURL(/\/student-feedback\/\d+/)

    const feedbackRow = page.locator('.student-marking-row', { hasText: account.studentName })
    await expect(feedbackRow.locator('.student-result-score')).toHaveText(/\d+\/\d+/)

    await feedbackRow.getByRole('button', { name: 'View feedback' }).click()
    await expect(feedbackRow.locator('.student-result-expanded')).toBeVisible()
})
