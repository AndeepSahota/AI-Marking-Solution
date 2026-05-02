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

export async function submitFiles(studentWork, markScheme) {
    const formData = new FormData()
    formData.append('studentWork', studentWork)
    formData.append('markScheme', markScheme)

    const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
    })

    const data = await response.json()

    if (response.status === 401) {
        throw new Error('Your session has expired. Please sign in again.')
    }

    if (!response.ok) {
        throw new Error(data.error || 'Something went wrong')
    }

    return data
}
