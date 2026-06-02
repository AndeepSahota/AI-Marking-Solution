import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { getStudents, getLessonOcr } from '../services/api'

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
  const { lessonId }    = useParams()
  const { state }       = useLocation()
  const navigate        = useNavigate()
  const [students, setStudents] = useState([])

  const classId   = state?.classId
  const className = state?.className

  const [ocrText, setOcrText]   = useState(null)
  const [ocrError, setOcrError] = useState(null)

  useEffect(() => {
    if (!classId) return
    getStudents(classId).then(setStudents).catch(() => {})
  }, [classId])

  useEffect(() => {
    if (!lessonId) return
    getLessonOcr(lessonId)
      .then(setOcrText)
      .catch(err => setOcrError(err.message))
  }, [lessonId])

  // Guard: if navigated directly without state, go home
  if (!classId) {
    navigate('/', { replace: true })
    return null
  }

  const marked = 0

  return (
    <div className="page">
      <div className="marking-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="marking-header-centre">
          <h2 className="marking-class-name">{className}</h2>
        </div>

        <ProgressRing marked={marked} total={students.length} />
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
          <span>Feedback</span>
        </div>

        {students.length === 0 ? (
          <p className="student-marking-empty">Loading students…</p>
        ) : (
          students.map(s => (
            <div key={s.id} className="student-marking-row">
              <span className="student-marking-name">{s.student_name}</span>
              <span className="student-marking-feedback-placeholder">Not yet marked</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default StudentMarking
