import { createContext, useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken, refreshSession } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const navigate = useNavigate()

    const [user, setUser] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('aimira_user') ?? 'null')
        } catch {
            return null
        }
    })

    const [token, setTokenState] = useState(() => localStorage.getItem('aimira_token'))

    // Sync token into the api module on boot (in case we restored from localStorage)
    if (token) setToken(token)

    const login = (newToken, newUser) => {
        localStorage.setItem('aimira_token', newToken)
        localStorage.setItem('aimira_user', JSON.stringify(newUser))
        setToken(newToken)
        setTokenState(newToken)
        setUser(newUser)
    }

    const logout = () => {
        localStorage.removeItem('aimira_token')
        localStorage.removeItem('aimira_user')
        setToken(null)
        setTokenState(null)
        setUser(null)
        navigate('/login')
    }

    // Called by the inactivity modal "Stay logged in" button.
    // Exchanges the current token (even if just expired) for a fresh one.
    // Returns true on success, false if the token is invalid (force logout).
    const refreshToken = async () => {
        const data = await refreshSession()
        if (!data) return false
        login(data.token, data.user)
        return true
    }

    return (
        <AuthContext.Provider value={{ user, token, login, logout, refreshToken }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => useContext(AuthContext)
