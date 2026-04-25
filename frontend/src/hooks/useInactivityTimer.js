import { useEffect, useRef, useCallback } from 'react'

const INACTIVITY_MS = 10 * 60 * 1000 // 10 minutes

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

/**
 * Calls onIdle() after INACTIVITY_MS of no user activity.
 * Resets automatically on any of the tracked browser events.
 * Only active when enabled=true (i.e. a user is logged in).
 */
export function useInactivityTimer({ onIdle, enabled }) {
    const timerRef = useRef(null)

    // Store latest onIdle in a ref so the event listener never goes stale
    // without needing to be re-registered
    const onIdleRef = useRef(onIdle)
    useEffect(() => { onIdleRef.current = onIdle }, [onIdle])

    // reset is stable (no deps) — safe to use as an event listener
    const reset = useCallback(() => {
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => onIdleRef.current(), INACTIVITY_MS)
    }, [])

    useEffect(() => {
        if (!enabled) {
            clearTimeout(timerRef.current)
            return
        }

        ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }))
        reset() // start the timer immediately on login

        return () => {
            ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, reset))
            clearTimeout(timerRef.current)
        }
    }, [enabled, reset])

    return { resetTimer: reset }
}
