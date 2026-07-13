function ResultCard({ result }) {
  const percentage = result.percentage ?? Math.round((result.score / result.maxScore) * 100)

  const getGrade = (pct) => {
    if (pct >= 85) return 9
    if (pct >= 75) return 8
    if (pct >= 65) return 7
    if (pct >= 55) return 6
    if (pct >= 45) return 5
    if (pct >= 35) return 4
    if (pct >= 25) return 3
    if (pct >= 15) return 2
    if (pct >= 5)  return 1
    return 'U'
  }

  const getGradeColour = (pct) => {
    if (pct >= 65) return '#10b981'
    if (pct >= 35) return '#f59e0b'
    return '#ef4444'
  }

  const getGradeLabel = (pct) => `~Grade ${getGrade(pct)}`

  const getBadgeClass = (pct) => {
    if (pct >= 65) return 'result-grade-badge grade-high'
    if (pct >= 35) return 'result-grade-badge grade-mid'
    return 'result-grade-badge grade-low'
  }

  const colour = getGradeColour(percentage)

  return (
    <div className="result-card">
      {result.teacherReviewRequired && (
        <div className="result-review-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <strong>Teacher review recommended</strong>
            <span> — The AI was less than 80% confident in this result. Please check the mark before returning it to the student.</span>
          </div>
        </div>
      )}

      {result.questionMismatch && (
        <div className="result-mismatch-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <strong>Question mismatch detected</strong>
            {result.questionMismatchReason && (
              <span> — {result.questionMismatchReason}</span>
            )}
            <span> Please check the question entered matches the mark scheme before relying on this result.</span>
          </div>
        </div>
      )}
      <div className="result-header">
        <div className="result-title-group">
          <span className="result-label">Marking Result</span>
          <span className="result-title">Assessment Complete</span>
        </div>
        <div className="result-grade-group">
          <span className={getBadgeClass(percentage)}>{getGradeLabel(percentage)}</span>
          <span className="result-grade-note">Boundaries vary by paper & year</span>
        </div>
      </div>

      <div className="result-score-section">
        <div className="score-row">
          <span className="score-number" style={{ color: colour }}>{result.score}</span>
          <span className="score-separator">/</span>
          <span className="score-max">{result.maxScore}</span>
        </div>

        <div className="progress-track">
          <div
            className="progress-fill"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${colour}cc, ${colour})`,
            }}
          />
        </div>

        <div className="progress-meta">
          <span className="progress-pct">{percentage}% achieved</span>
          <span className="progress-label">{result.score} marks out of {result.maxScore}</span>
        </div>
      </div>

      {result.breakdown && result.breakdown.length > 0 && (
        <div className="result-breakdown">
          <div className="section-label">Breakdown</div>
          {result.breakdown.map((item, index) => {
            const itemPct = Math.round((item.marks / item.maxMarks) * 100)
            return (
              <div key={index} className="breakdown-item">
                <div className="breakdown-item-row">
                  <span className="breakdown-name">{item.section}</span>
                  <div className="breakdown-bar-track">
                    <div
                      className="breakdown-bar-fill"
                      style={{ width: `${itemPct}%` }}
                    />
                  </div>
                  <span className="breakdown-score">{item.marks} / {item.maxMarks}</span>
                </div>
                {item.reason && (
                  <p className="breakdown-reason">{item.reason}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(result.strengths?.length > 0 || result.improvements?.length > 0 || result.actionableSteps?.length > 0) && (
        <div className="result-feedback">
          {result.strengths?.length > 0 && (
            <div className="feedback-section">
              <div className="section-label">Strengths</div>
              <ul className="feedback-list">
                {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {result.improvements?.length > 0 && (
            <div className="feedback-section">
              <div className="section-label">Areas for improvement</div>
              <ul className="feedback-list">
                {result.improvements.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {result.actionableSteps?.length > 0 && (
            <div className="feedback-section">
              <div className="section-label">Next steps</div>
              <ul className="feedback-list">
                {result.actionableSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ResultCard
