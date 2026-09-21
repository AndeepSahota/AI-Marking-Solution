import { defineConfig } from '@playwright/test'

// Runs against dev servers you start yourself (frontend, backend, ai-service,
// mssql) — deliberately no webServer auto-start here, since a real marking
// run needs all four already up. See frontend/e2e/README.md.
export default defineConfig({
    testDir: './e2e',
    timeout: 120_000,
    fullyParallel: false,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
})
