const API_BASE = import.meta.env.VITE_API_URL

export async function getClasses() {
    const response = await fetch(`${API_BASE}/classes`, { credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to fetch classes')
    return data
}

export async function getStudents(classId) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students`, { credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to fetch students')
    return data
}

export async function getLessonOcr(lessonId) {
    const response = await fetch(`${API_BASE}/lessons/${lessonId}/ocr`, { credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to load mark scheme')
    return data.ocr_text
}

// onEvent(event) fires for each streamed progress event:
//   { type: 'security_pass' }
//   { type: 'ai_dispatched' }
//   { type: 'ocr_file_type', fileType, pageCount }
//   { type: 'ocr_page', index, totalPages }
//   { type: 'done', data: { id, class_id, class_name } }
//   { type: 'error', message, detail, code, status }
export async function createLesson(classId, question, markSchemeFile, onEvent = () => {}) {
    const formData = new FormData()
    formData.append('classId', classId)
    formData.append('question', question)
    formData.append('markScheme', markSchemeFile)

    const response = await fetch(`${API_BASE}/lessons`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('ndjson')) {
        if (contentType.includes('json')) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to create lesson')
        }
        throw new Error(`Server error (${response.status}) — is the backend running?`)
    }

    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = null

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line)
            onEvent(event)
            if (event.type === 'done')  result = event.data
            if (event.type === 'error') throw new Error(event.message)
        }
    }

    if (!result) throw new Error('Lesson creation did not complete')
    return result
}

export async function createClass(className, students) {
    const response = await fetch(`${API_BASE}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ className, students }),
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) {
        throw new Error(`Server error (${response.status}) — is the backend running?`)
    }
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to create class')
    return data
}

export async function renameClass(classId, className) {
    const response = await fetch(`${API_BASE}/classes/${classId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ class_name: className }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to rename class')
    return data
}

export async function addStudentToClass(classId, studentName) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ student_name: studentName }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to add student')
    return data
}

export async function renameStudent(classId, studentId, studentName) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students/${studentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ student_name: studentName }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to rename student')
    return data
}

export async function deleteStudent(classId, studentId) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students/${studentId}`, {
        method: 'DELETE',
        credentials: 'include',
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to delete student')
    return data
}

// credentials: 'include' is required on every request so the browser
// attaches the httpOnly aimira_token cookie automatically.
// The token never touches JavaScript — it is set and cleared by the backend.

export async function selectQuestion(lessonId, selectedQuestionIndex) {
    const response = await fetch(`${API_BASE}/lessons/${lessonId}/select-question`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ selectedQuestionIndex }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to select question')
    return data
}

export async function getMarkingResults(lessonId) {
    const response = await fetch(`${API_BASE}/lessons/${lessonId}/results`, { credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to fetch results')
    return data.results
}

export async function submitStudentWork(lessonId, studentId, studentWorkFile, onEvent) {
    const formData = new FormData()
    formData.append('studentWork', studentWorkFile)
    formData.append('studentId', String(studentId))

    const response = await fetch(`${API_BASE}/lessons/${lessonId}/mark-student`, {
        method:      'POST',
        credentials: 'include',
        body:        formData,
    })

    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.')

    if (!response.headers.get('content-type')?.includes('ndjson')) {
        const data = await response.json()
        throw new Error(data.error || 'Something went wrong')
    }

    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = null

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line)
            onEvent(event)
            if (event.type === 'result') result = event.data
            if (event.type === 'error')  throw new Error(event.message)
        }
    }

    if (!result) throw new Error('No result received')
    return result
}

// onEvent fires for each streamed event:
//   { type: 'split',       total }
//   { type: 'ocr_complete' }
//   { type: 'result',      studentId, studentName, confidence, data }
//   { type: 'error',       message }
//   { type: 'done' }
export async function bulkMarkStudents(lessonId, pdfFile, pagesPerStudent, onEvent = () => {}) {
    const formData = new FormData()
    formData.append('pdfFile', pdfFile)
    formData.append('pagesPerStudent', String(pagesPerStudent))

    const response = await fetch(`${API_BASE}/lessons/${lessonId}/bulk-mark`, {
        method:      'POST',
        credentials: 'include',
        body:        formData,
    })

    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.')

    if (!response.headers.get('content-type')?.includes('ndjson')) {
        const data = await response.json()
        throw new Error(data.error || 'Bulk mark failed')
    }

    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
            if (!line.trim()) continue
            onEvent(JSON.parse(line))
        }
    }
}

export async function getExemplars() {
    const response = await fetch(`${API_BASE}/exemplars`, { credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to fetch exemplars')
    return data.exemplars
}

export async function addExemplar(file, questionNumber, score, maxMarks, band, source) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('question_number', questionNumber)
    formData.append('score',     String(score))
    formData.append('max_marks', String(maxMarks))
    if (band)   formData.append('band',   String(band))
    if (source) formData.append('source', source)

    const response = await fetch(`${API_BASE}/exemplars`, {
        method: 'POST', credentials: 'include', body: formData,
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to add exemplar')
    return data
}

export async function deleteExemplar(id) {
    const response = await fetch(`${API_BASE}/exemplars/${id}`, {
        method: 'DELETE', credentials: 'include',
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to delete exemplar')
    return data
}

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
