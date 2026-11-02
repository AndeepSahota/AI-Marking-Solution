import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getReviewEssay, getReviewList, saveReview } from '../services/api'
import ChangeMarkForm from '../components/ChangeMarkForm'
import { buildEvidenceSegments } from '../utils/evidenceSegments'
import { renderOcrText } from '../utils/renderOcrText'
import { nextToReview } from '../utils/reviewOrder'

// Seconds the page has been visible since the last reset -- time in another
// tab doesn't count towards the time spent on a review.
function useVisibleSeconds() {
  const total = useRef(0)
  const since = useRef(null)

  useEffect(() => {
    if (document.visibilityState === 'visible') since.current = Date.now()
    const onChange = () => {
      if (document.visibilityState === 'visible') {
        since.current = Date.now()
      } else if (since.current !== null) {
        total.current += Date.now() - since.current
        since.current = null
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const read = useCallback(() => {
    const running = since.current === null ? 0 : Date.now() - since.current
    return Math.round((total.current + running) / 1000)
  }, [])

  const reset = useCallback(() => {
    total.current = 0
    since.current = document.visibilityState === 'visible' ? Date.now() : null
  }, [])

  return { read, reset }
}

function HighlightedEssay({ text, quotes }) {
  const segments = useMemo(
    () => buildEvidenceSegments(text, quotes.map((quote, index) => ({ id: `quote-${index}`, quote }))).segments,
    [text, quotes]
  )
  return (
    <div className="annotated-essay-prose review-essay-prose">
      {segments.map((segment, index) => segment.type === 'text'
        ? <span key={index}>{renderOcrText(segment.content, `text-${index}`)}</span>
        : <mark key={index} className="review-highlight">{renderOcrText(segment.content, `mark-${index}`)}</mark>
      )}
    </div>
  )
}

const markText = (level, mark, maxMark) =>
  mark == null ? `Level ${level}` : `Level ${level} · ${mark}/${maxMark}`

function BorderlineBadge({ suggestion }) {
  if (!suggestion.borderline) return null
  const [low, high] = suggestion.borderlineLevels ?? []
  return (
    <span className="review-borderline-badge">
      {low && high ? `Borderline: between Level ${low} and ${high}` : 'Borderline'}
    </span>
  )
}

function SuggestionPanel({ suggestion }) {
  return (
    <div className="review-suggestion">
      <div className="review-suggestion-head">
        <span className="review-label">Suggested mark</span>
        <BorderlineBadge suggestion={suggestion} />
      </div>
      <p className="review-suggestion-mark">{markText(suggestion.level, suggestion.mark, suggestion.maxMark)}</p>
      {suggestion.threads.length > 0 && (
        <ul className="review-thread-list">
          {suggestion.threads.map(thread => (
            <li key={thread.label}>
              <span className="review-thread-label">{thread.label}</span>
              <span className="review-thread-reason">{thread.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReviewEssayPage() {
  const { lessonId, studentId } = useParams()
  const navigate = useNavigate()
  const timer = useVisibleSeconds()

  const [essay, setEssay] = useState(null)
  const [list, setList] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [changing, setChanging] = useState(false)
  const [allDone, setAllDone] = useState(false)

  const currentId = Number(studentId)
  const backToClass = () => navigate(`/review/${lessonId}`)

  useEffect(() => {
    // The class list first: it is what picks the blind checks, so the essay
    // read after it already knows whether to hide the suggestion.
    getReviewList(lessonId)
      .then(data => {
        setList(data)
        return getReviewEssay(lessonId, studentId)
      })
      .then(setEssay)
      .catch(setLoadError)
  }, [lessonId, studentId])

  const goToNext = (items) => {
    const next = nextToReview(items, currentId)
    if (next) navigate(`/review/${lessonId}/${next.studentId}`)
    else setAllDone(true)
  }

  const submit = async (choice) => {
    setSaving(true)
    setSaveError(null)
    try {
      const wasReviewed = Boolean(essay.review)
      const updated = await saveReview(lessonId, studentId, { ...choice, secondsSpent: timer.read() })
      timer.reset()
      const items = list.items.map(item => item.studentId === currentId ? { ...item, review: updated.review } : item)
      setList({ progress: { ...list.progress, reviewed: list.progress.reviewed + (wasReviewed ? 0 : 1) }, items })
      setChanging(false)
      setEssay(updated)
      // A blind check stays put to reveal the suggestion; anything else moves on.
      if (!updated.blind) goToNext(items)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    const message = loadError.status === 404 && loadError.message === 'Not found'
      ? "Teacher review isn't turned on."
      : loadError.message
    return (
      <div className="page">
        <p className="ms-ocr-error">{message}</p>
        <button className="back-btn review-back-standalone" onClick={backToClass}>Back to class list</button>
      </div>
    )
  }

  if (!essay || !list) {
    return <div className="page"><p className="ms-ocr-loading">Loading essay…</p></div>
  }

  const { suggestion, review, blind } = essay
  const blindPending = blind && !review

  return (
    <div className="page review-page">
      <div className="marking-header">
        <button className="back-btn" onClick={backToClass}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="marking-header-centre">
          <h2 className="marking-class-name">{essay.studentName}</h2>
        </div>
        <span className="review-progress">{list.progress.reviewed} of {list.progress.total} reviewed</span>
      </div>

      {allDone && (
        <div className="review-done" role="status">
          <p>Every essay in this class has been reviewed.</p>
          <button className="review-primary-btn" onClick={backToClass}>Back to class list</button>
        </div>
      )}

      <div className="review-layout">
        <section className="review-essay" aria-label="Student response">
          <div className="annotated-section-label">Student response</div>
          <HighlightedEssay text={essay.essayText} quotes={suggestion?.evidenceQuotes ?? []} />
        </section>

        <aside className="review-panel" aria-label="Review">
          {blindPending ? (
            <>
              <div className="review-blind-note">
                <span className="review-label">Blind check</span>
                <p>Choose the level you would give. The suggested mark is shown after you save.</p>
              </div>
              <ChangeMarkForm
                levels={essay.levels}
                suggestion={null}
                saving={saving}
                submitLabel="Save and show suggestion"
                onSubmit={submit}
              />
            </>
          ) : (
            <>
              <SuggestionPanel suggestion={suggestion} />

              {review && !changing && (
                <div className="review-saved" role="status">
                  <span className="review-label">{blind ? 'Your blind check' : 'Your review'}</span>
                  <p>
                    {blind
                      ? `You gave ${markText(review.teacherLevel, review.teacherMark, suggestion.maxMark)}${review.teacherLevel === suggestion.level ? ', the same level as the suggestion.' : '.'}`
                      : `${review.outcome === 'confirmed' ? 'Looks right: ' : 'Changed to '}${markText(review.teacherLevel, review.teacherMark, suggestion.maxMark)}`}
                  </p>
                  {blind ? (
                    <button className="review-primary-btn" onClick={() => goToNext(list.items)}>Next essay</button>
                  ) : (
                    <button className="review-secondary-btn" onClick={() => setChanging(true)}>Change your review</button>
                  )}
                </div>
              )}

              {!review && !changing && (
                <div className="review-actions">
                  <button
                    className="review-primary-btn"
                    disabled={saving}
                    onClick={() => submit({ teacherLevel: suggestion.level, teacherMark: null, reasonCodes: [] })}
                  >
                    {saving ? 'Saving…' : 'Looks right'}
                  </button>
                  <button className="review-secondary-btn" disabled={saving} onClick={() => setChanging(true)}>
                    Change mark
                  </button>
                </div>
              )}

              {changing && (
                <ChangeMarkForm
                  levels={essay.levels}
                  suggestion={suggestion}
                  initial={review ?? { teacherLevel: suggestion.level }}
                  saving={saving}
                  submitLabel="Save"
                  onSubmit={submit}
                  onCancel={() => setChanging(false)}
                />
              )}
            </>
          )}
          {saveError && <p className="review-field-error" role="alert">{saveError}</p>}
        </aside>
      </div>
    </div>
  )
}

// Keyed by student so moving to the next essay starts with fresh state and
// a fresh timer.
function ReviewEssay() {
  const { studentId } = useParams()
  return <ReviewEssayPage key={studentId} />
}

export default ReviewEssay
