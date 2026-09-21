// Creates a throwaway teacher + class + student via the real API, so specs
// don't depend on any account/data that happens to already exist in whoever's
// local database is running (works on a totally fresh DB — Umar's included).
// Setup only, not what's under test — API is faster and more reliable here
// than clicking through the signup/create-class UI for every spec.

const PASSWORD = 'Playwright-Test!!1' // 10+ chars, a digit, 2+ special chars, not a common password.

export async function createTestAccount(request, { className, studentName } = {}) {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const email = `pw-e2e-${unique}@example.com`
    const name = 'Playwright E2E'
    const resolvedClassName = className ?? `Year 10 Playwright ${unique}`
    const resolvedStudentName = studentName ?? 'Playwright Test Student'

    const signupRes = await request.post('/api/auth/signup', {
        data: { name, email, password: PASSWORD, confirmPassword: PASSWORD },
    })
    if (!signupRes.ok()) {
        throw new Error(`Test account signup failed: ${signupRes.status()} ${await signupRes.text()}`)
    }
    const cookies = signupRes.headersArray()
        .filter(h => h.name.toLowerCase() === 'set-cookie')
        .map(h => h.value.split(';')[0])
        .join('; ')

    const classRes = await request.post('/api/classes', {
        headers: { Cookie: cookies },
        data: { className: resolvedClassName, students: [resolvedStudentName] },
    })
    if (!classRes.ok()) {
        throw new Error(`Test class creation failed: ${classRes.status()} ${await classRes.text()}`)
    }

    return {
        email,
        password: PASSWORD,
        className: resolvedClassName,
        studentName: resolvedStudentName,
    }
}
