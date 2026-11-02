// Order essays are worked through on the review screens: borderline essays
// first, then blind checks, then the rest; reviewed ones last. Stable, so
// essays keep the backend's order within each group.
const STATUS_ORDER = {
  needs_checking: 0,
  blind_check: 1,
  not_reviewed: 2,
  changed: 3,
  confirmed: 3,
}

export function reviewOrder(items) {
  return [...items].sort((a, b) => (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2))
}

// The next unreviewed essay after currentStudentId, wrapping round to the
// start; null once every other essay has been reviewed.
export function nextToReview(items, currentStudentId) {
  const ordered = reviewOrder(items)
  const index = ordered.findIndex(item => item.studentId === currentStudentId)
  const after = [...ordered.slice(index + 1), ...ordered.slice(0, Math.max(index, 0))]
  return after.find(item => !item.review && item.studentId !== currentStudentId) ?? null
}
