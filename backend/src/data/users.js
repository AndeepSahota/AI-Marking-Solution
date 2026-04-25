import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createHmac } from 'crypto'
import bcrypt from 'bcrypt'

const __dirname = dirname(fileURLToPath(import.meta.url))
const USERS_PATH = join(__dirname, 'users.json')
const BCRYPT_COST = 12

// Load both peppers from their separate file at startup
const { passwordPepper: PASSWORD_PEPPER, emailPepper: EMAIL_PEPPER } = JSON.parse(
    readFileSync(join(__dirname, 'pepper.json'), 'utf-8')
)

// Emails use HMAC-SHA256 (deterministic) so login lookup remains possible.
// bcrypt's random salt cannot be used here — it would require comparing every
// stored hash on every login request.
function hashEmail(email) {
    return createHmac('sha256', EMAIL_PEPPER).update(email.toLowerCase()).digest('hex')
}

// Passwords use HMAC-SHA256 as input to bcrypt (which adds a random salt on top).
function applyPasswordPepper(password) {
    return createHmac('sha256', PASSWORD_PEPPER).update(password).digest('hex')
}

function readUsers() {
    return JSON.parse(readFileSync(USERS_PATH, 'utf-8'))
}

function writeUsers(users) {
    writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8')
}

export function findByEmail(email) {
    const target = hashEmail(email)
    return readUsers().find(u => u.emailHash === target)
}

export async function createUser({ name, email, password }) {
    const users = readUsers()

    const passwordHash = await bcrypt.hash(applyPasswordPepper(password), BCRYPT_COST)
    const user = {
        id: crypto.randomUUID(),
        name,
        emailHash: hashEmail(email),
        passwordHash,
        createdAt: new Date().toISOString(),
    }

    users.push(user)
    writeUsers(users)

    const { passwordHash: _, emailHash: __, ...safeUser } = user
    return { ...safeUser, name }
}

export async function verifyPassword(plaintext, hash) {
    return bcrypt.compare(applyPasswordPepper(plaintext), hash)
}
