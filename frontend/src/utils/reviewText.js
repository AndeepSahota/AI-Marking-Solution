// How a level and mark read on the review screens. Level 0 is "No credit".
export function levelName(level) {
  return level === 0 ? 'No credit' : `Level ${level}`
}

export function markText(level, mark, maxMark) {
  if (level == null) return null
  if (level === 0) return 'No credit · 0 marks'
  return mark == null ? levelName(level) : `${levelName(level)} · ${mark}/${maxMark}`
}

export function rangeText({ min, max }) {
  return min === max ? `${min} ${min === 1 ? 'mark' : 'marks'}` : `${min}–${max} marks`
}

// "could be 4" for a borderline essay: the other levels its borderline range
// covers. Null when not borderline or the range is unknown.
export function couldBeText(level, borderlineLevels) {
  if (level == null || !Array.isArray(borderlineLevels) || borderlineLevels.length !== 2) return null
  const [low, high] = borderlineLevels
  const others = []
  for (let other = low; other <= high; other++) if (other !== level) others.push(other)
  if (!others.length) return null
  const last = others.pop()
  return `could be ${others.length ? `${others.join(', ')} or ${last}` : last}`
}
