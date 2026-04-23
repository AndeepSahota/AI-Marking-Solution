import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import bcrypt from 'bcrypt'

const __dirname = dirname(fileURLToPath(import.meta.url))
const USERS_PATH = join(__dirname, 'users.json')

const BCRYPT_COST = 12

function readUsers() {
    const raw = readFileSync(USERS_PATH, 'utf-8')
    return JSON.parse(raw)
}

function writeUsers(users) {
    writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8')
}

export function findByEmail(email) {
    const users = readUsers()
    return users.find(u => u.email.toLowerCase() === email.toLowerCase())
}

export async function createUser({ name, email, password }) {
    const users = readUsers()

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const user = {
        id: crypto.randomUUID(),
        name,
        email: email.toLowerCase(),
        passwordHash,
        createdAt: new Date().toISOString(),
    }

    users.push(user)
    writeUsers(users)

    const { passwordHash: _, ...safeUser } = user
    return safeUser
}

export async function verifyPassword(plaintext, hash) {
    return bcrypt.compare(plaintext, hash)
}
