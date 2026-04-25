import { useState, useEffect, useRef } from 'react'

const COUNTDOWN_SECONDS = 60

function InactivityModal({ onStayLoggedIn, onLogout }) {
    const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS)
    const onLogoutRef = useRef(onLogout)
    useEffect(() => { onLogoutRef.current = onLogout }, [onLogout])

    useEffect(() => {
        const id = setInterval(() => {
            setSeconds(s => {
                if (s <= 1) {
                    clearInterval(id)
                    onLogoutRef.current()
                    return 0
                }
                return s - 1
            })
        }, 1000)
        return () => clearInterval(id)
    }, []) // runs once on mount

    const pct = (seconds / COUNTDOWN_SECONDS) * 100

    return (
        <div className="modal-overlay">
            <div className="modal-card">
                <div className="modal-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                </div>

                <div className="modal-body">
                    <h2 className="modal-title">Are you still there?</h2>
                    <p className="modal-subtitle">
                        You've been inactive. You will be logged out in{' '}
                        <span className="modal-countdown">{seconds}s</span>
                    </p>

                    <div className="modal-progress-track">
                        <div
                            className="modal-progress-fill"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>

                <div className="modal-actions">
                    <button className="modal-btn-primary" onClick={onStayLoggedIn}>
                        Stay logged in
                    </button>
                    <button className="modal-btn-ghost" onClick={onLogout}>
                        Log out now
                    </button>
                </div>
            </div>
        </div>
    )
}

export default InactivityModal
