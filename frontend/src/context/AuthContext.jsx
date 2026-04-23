import { createContext, useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken } from '../services/api'

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

    return (
        <AuthContext.Provider value={{ user, token, login, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => useContext(AuthContext)
