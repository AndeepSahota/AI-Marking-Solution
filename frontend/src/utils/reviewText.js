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
