import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getLesson, getLessonScheme, getStudents, getMarkingResults } from '../services/api'
import ResultCard from '../components/ResultCard'
import AnnotatedEssay from '../components/AnnotatedEssay'
import AggregationEvidenceEssay from '../components/AggregationEvidenceEssay'
import WrongQuestionWarning from '../components/WrongQuestionWarning'
import { feedbackResult } from '../utils/feedbackResult'

function StudentFeedback() {
  const { lessonId } = useParams()
  const navigate      = useNavigate()

  const [lesson,   setLesson]   = useState(null)
  const [students, setStudents] = useState([])
  const [results,        setResults]        = useState([])
  const [blindPendingIds, setBlindPendingIds] = useState([])
  const [reviewAvailable, setReviewAvailable] = useState(false)
  const [checks, setChecks] = useState(null)
  const [resultsLoading, setResultsLoading] = useState(true)
  const [resultsError,   setResultsError]   = useState(null)
  const [notFound,       setNotFound]       = useState(false)
  const [schemeData,     setSchemeData]     = useState(null)
  const [essayExpanded, setEssayExpanded] = useState({})

  // Same direct-visit/refresh pattern as StudentMarking: re-derive everything
  // from lessonId alone rather than trusting router state.
  useEffect(() => {
    if (!lessonId) { navigate('/', { replace: true }); return }

    getLesson(lessonId)
      .then(l => {
        setLesson(l)
        return getStudents(l.class_id)
      })
      .then(setStudents)
      .catch(() => setNotFound(true))

    // Keep the selected question's scheme and compact descriptorThreads map
    // together; the card still only uses the scheme until evidence placement
    // is designed.
    getLessonScheme(lessonId)
      .then(setSchemeData)
      .catch(() => setSchemeData(null))

    // /results only ever returns rows that have actually been marked — this
    // page shows exactly that set, nothing invented for unmarked students.
    // A fetch failure is surfaced explicitly rather than shown as "no
    // results" — those are different states and shouldn't look the same.
    getMarkingResults(lessonId)
      .then(data => {
        setResults(data.results)
        setBlindPendingIds(data.blindPendingStudentIds)
        setReviewAvailable(data.reviewAvailable)
        setChecks(data.checks)
      })
      .catch(err => setResultsError(err.message))
      .finally(() => setResultsLoading(false))
  }, [lessonId, navigate])

  if (notFound) {
    navigate('/', { replace: true })
    return null
  }

  const nameFor = (studentId) =>
    students.find(s => s.id === studentId)?.student_name ?? `Student #${studentId}`

  // Essays the teacher should look at (teacher review on): the warning shows
  // on any lesson; the count and links only where review is available.
  const wrongQuestionNote = (studentId) => checks?.wrongQuestion?.[studentId]
  const needsCheck = (studentId) => reviewAvailable && Boolean(checks?.byStudent?.[studentId])
  const checkCount = reviewAvailable ? checks?.count ?? 0 : 0

  const needsCheckTag = (studentId) => needsCheck(studentId)
    ? <Link className="needs-check-tag" to={`/review/${lessonId}/${studentId}`}>Needs your check</Link>
    : null

  const toggleEssayExpanded = (studentId) =>
    setEssayExpanded(prev => ({ ...prev, [studentId]: !prev[studentId] }))

  return (
    <div className="page">
      <div className="marking-header">
        <button className="back-btn" onClick={() => navigate(`/student-marking/${lessonId}`)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="marking-header-centre">
          <h2 className="marking-class-name">{lesson?.class_name ?? '…'} — Feedback</h2>
        </div>

        {reviewAvailable && (
          <Link className="review-entry-btn" to={`/review/${lessonId}`}>Review marks</Link>
        )}
      </div>

      <div className="student-feedback-list">
        {resultsError ? (
          <p className="ms-ocr-error">{resultsError}</p>
        ) : resultsLoading ? (
          <p className="ms-ocr-loading">Loading results…</p>
        ) : results.length === 0 && blindPendingIds.length === 0 ? (
          <p className="student-marking-empty">No marked work yet.</p>
        ) : (
          <>
          {checkCount > 0 && (
            <div className="needs-check-banner" role="status">
              <p>
                <strong>{checkCount} {checkCount === 1 ? 'essay needs' : 'essays need'} your check</strong>
                <span>Borderline marks, blind checks and essays that may answer a different question.</span>
              </p>
              <Link className="review-entry-btn" to={`/review/${lessonId}`}>Review marks</Link>
            </div>
          )}
          {/* Blind checks: their feedback is held back until the teacher has
              chosen a level, so the AI's mark can't sway them. */}
          {blindPendingIds.map(studentId => (
            <div key={`blind-${studentId}`} className="result-card review-blind-feedback">
              <span className="result-student-name">{nameFor(studentId)}</span>
              {wrongQuestionNote(studentId) !== undefined && <WrongQuestionWarning reason={wrongQuestionNote(studentId)} />}
              <p className="feedback-notice">
                <Link to={`/review/${lessonId}/${studentId}`}>Review this essay to see its feedback</Link>
              </p>
            </div>
          ))}
          {results.map(r => {
            const isEssayExpanded = essayExpanded[r.studentId]
            const { result, evidenceResult, studentText, finalUnavailable } = feedbackResult(r)
            const evidenceCount = evidenceResult?.evidence?.length ?? 0

            return (
              <div key={r.studentId} className="student-feedback-row">
                {wrongQuestionNote(r.studentId) !== undefined && <WrongQuestionWarning reason={wrongQuestionNote(r.studentId)} />}
                {finalUnavailable && (
                  <p role="status" className="feedback-notice">
                    Final marking is unavailable for this result. Showing the earlier mark and feedback.
                  </p>
                )}
                <ResultCard
                  studentName={nameFor(r.studentId)}
                  result={result}
                  scheme={schemeData?.scheme}
                  badge={needsCheckTag(r.studentId)}
                />
                {studentText && (
                  <>
                    <button
                      className="essay-toggle-btn"
                      onClick={() => toggleEssayExpanded(r.studentId)}
                      aria-expanded={isEssayExpanded}
                    >
                      {isEssayExpanded
                        ? 'Hide annotated essay'
                        : evidenceCount > 0
                          ? `Annotated essay · ${evidenceCount} evidence point${evidenceCount === 1 ? '' : 's'}`
                          : 'Annotated essay'}
                    </button>
                    {isEssayExpanded && (
                      evidenceCount > 0 ? (
                        <AggregationEvidenceEssay
                          text={studentText}
                          aggregationResult={evidenceResult}
                        />
                      ) : (
                        <AnnotatedEssay
                          text={studentText}
                          annotations={[]}
                        />
                      )
                    )}
                  </>
                )}
              </div>
            )
          })}
          </>
        )}
      </div>
    </div>
  )
}

export default StudentFeedback
