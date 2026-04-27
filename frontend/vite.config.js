import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const apiUrl = env.VITE_API_URL || ''

    // Dev CSP: 'unsafe-inline' is required because Vite's dev server injects the
    // React Refresh preamble as an inline <script> and CSS as inline <style> elements.
    // These are Vite internals that cannot carry a nonce — they go away in the built output.
    const devCSP = [
        "default-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        `connect-src 'self' ws://localhost:* ${apiUrl}`,
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ')

    // Production CSP: the built output has no inline scripts or styles — Vite extracts
    // everything into hashed asset files served from 'self'. 'unsafe-inline' is dropped.
    const prodCSP = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        `connect-src 'self' ${apiUrl}`,
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ')

    const csp = mode === 'production' ? prodCSP : devCSP

    return {
        plugins: [react()],
        server: {
            headers: { 'Content-Security-Policy': csp },
        },
        preview: {
            headers: { 'Content-Security-Policy': prodCSP },
        },
    }
})
