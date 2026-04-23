import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'
import './App.css'

function ProtectedRoute({ children }) {
    const { user } = useAuth()
    return user ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
    const { user } = useAuth()
    return user ? <Navigate to="/" replace /> : children
}

function Header() {
    const { user, logout } = useAuth()

    return (
        <header className="header">
            <div className="header-inner">
                <div className="brand">
                    <div className="brand-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2L2 7l10 5 10-5-10-5z" />
                            <path d="M2 17l10 5 10-5" />
                            <path d="M2 12l10 5 10-5" />
                        </svg>
                    </div>
                    <span className="brand-name">AIMIRA</span>
                    <span className="brand-badge">Beta</span>
                </div>

                {user ? (
                    <div className="header-user">
                        <span className="header-user-name">{user.name}</span>
                        <button className="header-logout-btn" onClick={logout}>
                            Sign out
                        </button>
                    </div>
                ) : (
                    <div className="header-status">
                        <div className="status-dot" />
                        <span>AI online</span>
                    </div>
                )}
            </div>
        </header>
    )
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Header />
                <Routes>
                    <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
                    <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
                    <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    )
}

export default App
