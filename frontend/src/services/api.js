const API_BASE = import.meta.env.VITE_API_URL

// credentials: 'include' is required on every request so the browser
// attaches the httpOnly aimira_token cookie automatically.
// The token never touches JavaScript — it is set and cleared by the backend.

export async function refreshSession() {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
    })
    if (!response.ok) return null
    return response.json()
}

// onEvent(event) is called for each streamed event as it arrives:
//   { type: 'security', checks: [...] }  — fired immediately after security checks
//   { type: 'result',   data: {...}    }  — fired when OCR + marking completes
//   { type: 'error',    message: '...' }  — fired if the AI service fails
export async function submitFiles(studentWork, markScheme, onEvent) {
    const formData = new FormData()
    formData.append('studentWork', studentWork)
    formData.append('markScheme', markScheme)

    const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
    })

    // Auth check is unconditional — a 401 must always redirect to login regardless
    // of whether the response arrived as plain JSON or mid-stream NDJSON.
    if (response.status === 401) {
        throw new Error('Your session has expired. Please sign in again.')
    }

    // Non-streaming error responses (security failures, rate limits) come back as plain JSON
    if (!response.headers.get('content-type')?.includes('ndjson')) {
        const data = await response.json()
        throw Object.assign(new Error(data.error || 'Something went wrong'), { debug: data._debug })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = null

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep any incomplete trailing line

        for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line)
            onEvent(event)
            if (event.type === 'result') result = event.data
            if (event.type === 'error')  throw Object.assign(new Error(event.message), { detail: event.detail, code: event.code, status: event.status })
        }
    }

    if (!result) throw new Error('No result received')
    return result
}
