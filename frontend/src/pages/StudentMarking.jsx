import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getLesson, getStudents, getLessonOcr,
  getMarkingResults, submitStudentWork,
} from '../services/api'
import ResultCard from '../components/ResultCard'
import AnnotatedEssay from '../components/AnnotatedEssay'

const CIRCUMFERENCE = 2 * Math.PI * 26 // r=26 → ≈163.4

function ProgressRing({ marked, total }) {
  const progress = total > 0 ? (marked / total) * CIRCUMFERENCE : 0

  return (
    <div className="progress-ring">
      <svg viewBox="0 0 60 60" className="progress-ring-svg">
        <circle cx="30" cy="30" r="26" fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          cx="30" cy="30" r="26"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${CIRCUMFERENCE}`}
          transform="rotate(-90 30 30)"
        />
      </svg>
      <div className="progress-ring-label">
        <span className="progress-ring-count">{marked}</span>
        <span className="progress-ring-sep">/</span>
        <span className="progress-ring-total">{total}</span>
      </div>
    </div>
  )
}

function StudentMarking() {
  const { lessonId } = useParams()
  const navigate     = useNavigate()

  const [lesson,   setLesson]   = useState(null)
  const [students, setStudents] = useState([])
  const [ocrText,  setOcrText]  = useState(null)
  const [ocrError, setOcrError] = useState(null)
  const [notFound, setNotFound] = useState(false)

  // { [studentId]: { status: 'marking'|'done'|'error', result?, error? } }
  const [markStates, setMarkStates] = useState({})
  const [expanded,   setExpanded]   = useState({})

  const fileInputRef   = useRef(null)
  const pendingStudent = useRef(null)

  // Fetch lesson metadata first, then use its class_id to fetch students.
  // Both lesson and OCR fetches fire immediately since both only need lessonId.
  // DB-backed from lessonId alone (not passed via router state) so this page
  // works from a direct visit or a refresh, not just immediately after
  // navigating here from Home.
  useEffect(() => {
    if (!lessonId) { navigate('/', { replace: true }); return }

    getLesson(lessonId)
      .then(l => {
        setLesson(l)
        return getStudents(l.class_id)
      })
      .then(setStudents)
      .catch(() => setNotFound(true))

    getLessonOcr(lessonId)
      .then(setOcrText)
      .catch(err => setOcrError(err.message))
  }, [lessonId])

  // Single source of truth for anything displayed as a result: always a read
  // from marking_results, never the API response of whichever request just
  // finished. Merges into existing state rather than replacing it wholesale,
  // so it can't clobber another student's still-in-flight 'marking' status —
  // getMarkingResults only ever returns rows that have actually been
  // persisted, so a student mid-upload elsewhere just wouldn't be in it yet.
  const refreshResults = useCallback(async () => {
    const results = await getMarkingResults(lessonId)
    setMarkStates(prev => {
      const next = { ...prev }
      for (const r of results) {
        next[r.studentId] = { status: 'done', result: r.result }
      }
      return next
    })
  }, [lessonId])

  // Load any marking results already persisted for this lesson, so a
  // refresh (or coming back later) shows existing marks, not a blank list.
  useEffect(() => {
    if (!lessonId) return
    refreshResults().catch(() => {})
  }, [lessonId, refreshResults])

  if (notFound) {
    navigate('/', { replace: true })
    return null
  }

  const markedCount = Object.values(markStates).filter(s => s.status === 'done').length

  const handleUploadClick = (studentId) => {
    pendingStudent.current = studentId
    fileInputRef.current.value = ''
    fileInputRef.current.click()
  }

  const handleFileSelected = async (e) => {
    const file      = e.target.files[0]
    const studentId = pendingStudent.current
    if (!file || !studentId) return

    setMarkStates(prev => ({ ...prev, [studentId]: { status: 'marking' } }))

    try {
      // Plain request now, not streamed — its response is only used to know
      // marking finished (or failed). What's displayed comes from
      // refreshResults(), a fresh read of what actually got persisted.
      await submitStudentWork(lessonId, studentId, file)
      await refreshResults()
      setExpanded(prev => ({ ...prev, [studentId]: true }))
    } catch (err) {
      setMarkStates(prev => ({ ...prev, [studentId]: { status: 'error', error: err.message } }))
    }
  }

  const toggleExpanded = (studentId) =>
    setExpanded(prev => ({ ...prev, [studentId]: !prev[studentId] }))

  return (
    <div className="page">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.pdf"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      <div className="marking-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="marking-header-centre">
          <h2 className="marking-class-name">{lesson?.class_name ?? '…'}</h2>
        </div>

        <ProgressRing marked={markedCount} total={students.length} />
      </div>

      <div className="ms-ocr-box">
        <h3 className="ms-ocr-title">Mark Scheme</h3>
        {ocrError ? (
          <p className="ms-ocr-error">{ocrError}</p>
        ) : ocrText === null ? (
          <p className="ms-ocr-loading">Loading mark scheme…</p>
        ) : (
          <pre className="ms-ocr-text">{ocrText}</pre>
        )}
      </div>

      <div className="student-marking-list">
        <div className="student-marking-header-row">
          <span>Student</span>
          <span>Result</span>
        </div>

        {students.length === 0 ? (
          <p className="student-marking-empty">Loading students…</p>
        ) : (
          students.map(s => {
            const st         = markStates[s.id]
            const status     = st?.status
            const isExpanded = expanded[s.id]

            return (
              <div key={s.id} className="student-marking-row">
                <span className="student-marking-name">{s.student_name}</span>

                <div className="student-mark-actions">
                  {status === 'marking' ? (
                    <span className="student-marking-feedback-placeholder">Marking…</span>
                  ) : status === 'done' ? (
                    <div className="student-result-row">
                      <span className="student-result-score">
                        {st.result.score}/{st.result.maxScore}
                      </span>
                      <button className="student-expand-btn" onClick={() => toggleExpanded(s.id)}>
                        {isExpanded ? 'Hide' : 'View feedback'}
                      </button>
                      <button className="student-remark-btn" onClick={() => handleUploadClick(s.id)}>
                        Re-mark
                      </button>
                    </div>
                  ) : status === 'error' ? (
                    <div className="student-result-row">
                      <span className="student-mark-error">{st.error || 'Marking failed'}</span>
                      <button className="student-upload-btn" onClick={() => handleUploadClick(s.id)}>
                        Retry
                      </button>
                    </div>
                  ) : (
                    <button className="student-upload-btn" onClick={() => handleUploadClick(s.id)}>
                      Upload work
                    </button>
                  )}
                </div>

                {status === 'done' && isExpanded && (
                  <div className="student-result-expanded">
                    <ResultCard result={st.result} />
                    {st.result.studentOcrText && st.result.annotations?.length > 0 && (
                      <AnnotatedEssay
                        text={st.result.studentOcrText}
                        annotations={st.result.annotations}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default StudentMarking
