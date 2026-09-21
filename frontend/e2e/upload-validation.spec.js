import { test, expect } from '@playwright/test'
import { createTestAccount } from './helpers/testAccount.js'

// These three all fail before ever reaching OCR/AI — no API cost, fast,
// deterministic. Locks in the three clean-error fixes from earlier in this
// project (wrong file type, oversized upload, a file that only pretends to
// be a PDF) so a regression here shows up as a failing test, not another
// live-testing session rediscovering the same bug from scratch.

let account

test.beforeAll(async ({ request }) => {
    account = await createTestAccount(request)
})

test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(account.email)
    await page.getByLabel('Password').fill(account.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('/')
    await page.locator('select.home-class-select').selectOption({ label: account.className })
})

test('rejects a file that is not a PDF or image, with a clean message', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({
        name: 'essay-notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('This is just a plain text file, not a real mark scheme.'),
    })
    await page.getByRole('button', { name: 'Begin marking' }).click()

    await expect(page.locator('.home-error')).toHaveText('Only PDF and image files are accepted')
    // Must not have navigated away or silently "succeeded".
    await expect(page).toHaveURL('/')
})

test('rejects a file over the 5 MB limit, with a clean message', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({
        name: 'huge-mark-scheme.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(6 * 1024 * 1024, 'A'),
    })
    await page.getByRole('button', { name: 'Begin marking' }).click()

    await expect(page.locator('.home-error')).toHaveText('This file is too large to upload')
    await expect(page).toHaveURL('/')
})

test('rejects a file with a .pdf name and MIME type that is not real PDF structure', async ({ page }) => {
    // Real PDF magic bytes so it passes the extension/declared-MIME checks,
    // but no real PDF structure behind them — pdf-lib can't parse it.
    await page.locator('input[type="file"]').setInputFiles({
        name: 'corrupt.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n' + 'not a real pdf structure, just text after the header'.repeat(20)),
    })
    await page.getByRole('button', { name: 'Begin marking' }).click()

    await expect(page.locator('.home-error')).toHaveText('This file doesn\'t appear to be a valid PDF')
    await expect(page).toHaveURL('/')
})
