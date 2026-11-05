import { useState } from 'react'
import { levelName, rangeText } from '../utils/reviewText'

const REASONS = [
  { code: 'too_generous', label: 'Too generous' },
  { code: 'too_harsh', label: 'Too harsh' },
  { code: 'missed_evidence', label: 'Missed evidence' },
  { code: 'misread_question', label: 'Misread the question' },
  { code: 'other', label: 'Other' },
]

// The mark box starts with the suggested mark while the suggested level is
// chosen, and empty for any other level -- the mark is optional either way.
function prefilledMark(level, suggestion) {
  return suggestion && level === suggestion.level ? String(suggestion.mark) : ''
}

// Level is required, the exact mark and reasons are optional. With no
// suggestion (a blind check) there is nothing to give reasons against, so
// the reason chips are hidden.
function ChangeMarkForm({ levels, suggestion, initial, saving, submitLabel, onSubmit, onCancel }) {
  const [level, setLevel] = useState(initial?.teacherLevel ?? null)
  const [mark, setMark] = useState(
    initial?.teacherMark != null ? String(initial.teacherMark) : prefilledMark(initial?.teacherLevel, suggestion)
  )
  const [reasons, setReasons] = useState(initial?.reasonCodes ?? [])

  const band = levels.find(item => item.level === level)
  const markNumber = mark.trim() === '' ? null : Number(mark)
  const markError = band && markNumber !== null
    && (!Number.isInteger(markNumber) || markNumber < band.min || markNumber > band.max)
    ? `Enter a whole mark from ${band.min} to ${band.max}, or leave it blank.`
    : null

  const chooseLevel = (next) => {
    setLevel(next)
    setMark(prefilledMark(next, suggestion))
  }

  const toggleReason = (code) =>
    setReasons(prev => prev.includes(code) ? prev.filter(item => item !== code) : [...prev, code])

  const submit = (event) => {
    event.preventDefault()
    if (!band || markError) return
    onSubmit({ teacherLevel: level, teacherMark: markNumber, reasonCodes: suggestion ? reasons : [] })
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <fieldset className="review-fieldset">
        <legend className="review-legend">Level</legend>
        <div className="review-level-options">
          {levels.map(item => (
            <button
              key={item.level}
              type="button"
              className={`review-level-option${item.level === level ? ' review-level-option--selected' : ''}`}
              aria-pressed={item.level === level}
              onClick={() => chooseLevel(item.level)}
            >
              <span className="review-level-name">{levelName(item.level)}</span>
              <span className="review-level-range">{rangeText(item)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Only one possible mark (e.g. No credit): nothing to choose. */}
      {band && band.min !== band.max && (
        <label className="review-mark-field">
          <span className="review-legend">Mark <span className="review-optional">(optional)</span></span>
          <input
            type="number"
            inputMode="numeric"
            min={band.min}
            max={band.max}
            step="1"
            value={mark}
            placeholder={`${band.min}–${band.max}`}
            onChange={event => setMark(event.target.value)}
            aria-invalid={Boolean(markError)}
          />
          {markError && <span className="review-field-error">{markError}</span>}
        </label>
      )}

      {suggestion && (
        <fieldset className="review-fieldset">
          <legend className="review-legend">Why? <span className="review-optional">(optional)</span></legend>
          <div className="review-reason-chips">
            {REASONS.map(reason => (
              <button
                key={reason.code}
                type="button"
                className={`review-chip${reasons.includes(reason.code) ? ' review-chip--selected' : ''}`}
                aria-pressed={reasons.includes(reason.code)}
                onClick={() => toggleReason(reason.code)}
              >
                {reason.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="review-form-actions">
        {onCancel && (
          <button type="button" className="review-secondary-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="review-primary-btn" disabled={!band || Boolean(markError) || saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export default ChangeMarkForm
