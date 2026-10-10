import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getLessonQuestions, selectQuestion } from '../services/api'

// Its own route (not state on Home) so it's DB-backed and refresh-safe: the
// only thing it needs is lessonId from the URL, then it reads the stored
// structured_scheme back via GET /lessons/:id/questions — the same "central
// fetcher" read path used elsewhere, rather than trusting a one-time stream.
function SelectQuestion() {
  const { lessonId } = useParams()
  const navigate = useNavigate()

  const [questions, setQuestions] = useState(null)
  const [error, setError] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [pickingQuestion, setPickingQuestion] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [questionText, setQuestionText] = useState('')

  const chooseQuestion = (index, list = questions) => {
    setSelectedIndex(index)
    setQuestionText(list[index]?.question_text ?? '')
    setError(null)
  }

  useEffect(() => {
    if (!lessonId) { navigate('/', { replace: true }); return }

    getLessonQuestions(lessonId)
      .then(data => {
        const list = data.questions ?? []
        setQuestions(list)
        // Nothing to pick on a single-question paper -- go straight to
        // confirming its wording.
        if (list.length === 1) chooseQuestion(0, list)
      })
      .catch(() => setNotFound(true))
  }, [lessonId])

  if (notFound) {
    navigate('/', { replace: true })
    return null
  }

  const handleConfirmQuestion = async () => {
    if (pickingQuestion || selectedIndex === null) return
    if (!questionText.trim()) return setError('Please enter the question your students answered.')
    setPickingQuestion(true)
    try {
      await selectQuestion(lessonId, selectedIndex, questionText.trim())
      navigate(`/student-marking/${lessonId}`)
    } catch (err) {
      setError(err.message)
      setPickingQuestion(false)
    }
  }

  return (
    <div className="home-page">
      <div className="home-grid">
        <section className="home-marketing">
          <div className="home-eyebrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            AI-POWERED ASSISTANT
          </div>

          <h1 className="home-title">
            Smarter marking,<br />
            <span className="home-title-accent">better outcomes.</span>
          </h1>

          <p className="home-description">
            Choose your class, upload the mark scheme, and let KLASSIO's AI do the heavy
            lifting—so you can focus on what matters most: your students.
          </p>
        </section>

        <section className="home-action-card">
          <div className="home-action-header">
            <h2 className="home-action-title">Which question are you marking?</h2>
          </div>

          {questions === null ? (
            <p className="question-picker-hint">Loading questions…</p>
          ) : (
            <>
              {questions.length > 1 && (
                <>
                  <p className="question-picker-hint">
                    We found {questions.length} questions in this mark scheme.
                    Select the one your students answered.
                  </p>
                  <div className="question-picker-grid">
                    {questions.map((q, i) => (
                      <button
                        key={i}
                        className={`question-card${i === selectedIndex ? ' question-card--selected' : ''}${pickingQuestion ? ' question-card--disabled' : ''}`}
                        onClick={() => chooseQuestion(i)}
                        disabled={pickingQuestion}
                      >
                        <span className="question-card-number">{q.question_number}</span>
                        <span className="question-card-desc">{q.description}</span>
                        <span className="question-card-marks">{q.marks} marks</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selectedIndex !== null && (
                <div className="question-confirm">
                  <label className="question-confirm-label" htmlFor="question-confirm-text">
                    {questions[selectedIndex]?.question_text
                      ? 'We found this question in your mark scheme. Check it matches the paper:'
                      : "We couldn't find the question wording in your mark scheme. Paste it from the paper:"}
                  </label>
                  <textarea
                    id="question-confirm-text"
                    className="question-confirm-text"
                    value={questionText}
                    onChange={e => setQuestionText(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    disabled={pickingQuestion}
                  />
                  {error && <p className="home-error">{error}</p>}
                  <button
                    className="home-begin-btn"
                    onClick={handleConfirmQuestion}
                    disabled={pickingQuestion || !questionText.trim()}
                  >
                    Confirm question
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default SelectQuestion
