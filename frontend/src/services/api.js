const API_BASE = import.meta.env.VITE_API_URL

let _token = null

export function setToken(token) {
    _token = token
}

export async function submitFiles(studentWork, markScheme) {
    const formData = new FormData()
    formData.append('studentWork', studentWork)
    formData.append('markScheme', markScheme)

    const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
            Authorization: `Bearer ${_token}`,
        },
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
