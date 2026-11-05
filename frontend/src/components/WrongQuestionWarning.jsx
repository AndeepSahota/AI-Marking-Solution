// Shown when the marker thinks the essay answers a different question from
// the one set. Deliberately louder than the borderline badge: if it's right,
// the mark means little until the teacher has looked.
function WrongQuestionWarning({ reason }) {
  return (
    <div className="wrong-question-warning" role="alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        <p className="wrong-question-title">Answered a different question?</p>
        {reason && <p className="wrong-question-reason">{reason}</p>}
      </div>
    </div>
  )
}

export default WrongQuestionWarning
