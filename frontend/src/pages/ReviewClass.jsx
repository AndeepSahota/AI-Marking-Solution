import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getLesson, getReviewList } from '../services/api'
import { reviewOrder } from '../utils/reviewOrder'
import { markText } from '../utils/reviewText'

const STATUS_LABELS = {
  needs_checking: 'Needs checking',
  blind_check: 'Blind check',
  not_reviewed: 'Not reviewed',
  confirmed: 'Confirmed',
  changed: 'Changed',
}


function EssayRow({ item, lessonId }) {
  const suggested = markText(item.level, item.mark, item.maxMark)
  const changedTo = item.status === 'changed'
    ? markText(item.review.teacherLevel, item.review.teacherMark, item.maxMark)
    : null

  return (
    <li>
      <Link className="review-class-row" to={`/review/${lessonId}/${item.studentId}`}>
        <span className="review-class-name">
          {item.studentName}
          {item.wrongQuestion && <span className="review-class-wrong-question">Different question?</span>}
        </span>
        <span className="review-class-mark">
          {changedTo ? (
            <>
              <s>{suggested}</s> {changedTo}
            </>
          ) : suggested ?? 'Hidden until you review it'}
        </span>
        <span className={`review-status review-status--${item.status}`}>{STATUS_LABELS[item.status]}</span>
      </Link>
    </li>
  )
}

function ReviewClass() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const [lesson, setLesson] = useState(null)
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getLesson(lessonId).then(setLesson).catch(() => setLesson(null))
    getReviewList(lessonId).then(setList).catch(setError)
  }, [lessonId])

  const backToFeedback = () => navigate(`/student-feedback/${lessonId}`)

  const header = (
    <div className="marking-header">
      <button className="back-btn" onClick={backToFeedback}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>
      <div className="marking-header-centre">
        <h2 className="marking-class-name">{lesson?.class_name ?? '…'} — Review marks</h2>
      </div>
    </div>
  )

  if (error) {
    const message = error.status === 404 && error.message === 'Not found'
      ? "Teacher review isn't turned on."
      : error.message
    return <div className="page">{header}<p className="ms-ocr-error">{message}</p></div>
  }

  if (!list) {
    return <div className="page">{header}<p className="ms-ocr-loading">Loading essays…</p></div>
  }

  const items = reviewOrder(list.items)
  const firstToReview = items.find(item => !item.review)
  const { reviewed, total } = list.progress

  return (
    <div className="page">
      {header}

      {total === 0 ? (
        <p className="student-marking-empty">No marked work yet.</p>
      ) : (
        <>
          <div className="review-class-summary">
            <div className="review-class-progress">
              <span>{reviewed} of {total} reviewed</span>
              <div className="progress-track" aria-hidden="true">
                <div className="review-class-progress-fill" style={{ width: `${(reviewed / total) * 100}%` }} />
              </div>
            </div>
            {firstToReview ? (
              <Link className="review-primary-btn review-start-btn" to={`/review/${lessonId}/${firstToReview.studentId}`}>
                {reviewed === 0 ? 'Start reviewing' : 'Carry on reviewing'}
              </Link>
            ) : (
              <p className="review-class-all-done">All essays reviewed.</p>
            )}
          </div>

          <p className="review-class-hint">
            Essays that may answer a different question come first, then borderline marks. Blind checks hide the suggested mark until you have chosen yours.
          </p>

          <ul className="review-class-list">
            {items.map(item => <EssayRow key={item.studentId} item={item} lessonId={lessonId} />)}
          </ul>
        </>
      )}
    </div>
  )
}

export default ReviewClass
