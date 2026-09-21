// Accepts "10e", "Year 10", "Year 10 Set 3 English" — uses the explicit "year N"
// form first, falls back to a leading digit run. The (?!\.\d) guard stops a
// decimal like "7.5" from being silently truncated to a valid-looking "7" —
// \d+ alone matches only the digits before the decimal point and ignores the
// rest, so without the guard "7.5" parsed as year 7 undetected.
export function parseYear(className) {
    const m = className.match(/year\s*(\d+)(?!\.\d)/i) ?? className.match(/^(\d+)(?!\.\d)/)
    return m ? parseInt(m[1], 10) : null
}
