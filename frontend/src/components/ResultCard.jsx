import { levelName, markText } from '../utils/reviewText'

function descriptorsForBreakdownItem(scheme, item) {
  const objectives = scheme?.assessment_objectives
  if (!Array.isArray(objectives)) return []

  const objective = objectives.find(ao => ao?.ao === item.section)
  const bands = objective?.bands
  if (!Array.isArray(bands)) return []

  const band = bands.find(candidate => candidate?.band === item.awardedBand)
  return Array.isArray(band?.descriptors) ? band.descriptors : []
}

// checked: the teacher's review ({ level, mark, markRange, maxMark, suggested }),
// shown instead of the suggested mark. couldBe: e.g. "could be 4" for a
// borderline essay not yet reviewed.
function ResultCard({ studentName, result, scheme, badge = null, checked = null, couldBe = null }) {
  const singleAo = Array.isArray(result.breakdown) && result.breakdown.length === 1
  const teacher = singleAo ? checked : null
  const teacherMark = teacher?.mark ?? (teacher?.markRange ? (teacher.markRange.min + teacher.markRange.max) / 2 : null)
  const percentage = teacherMark != null
    ? Math.round((teacherMark / teacher.maxMark) * 100)
    : result.percentage ?? Math.round((result.score / result.maxScore) * 100)
  const scoreText = !teacher ? result.score
    : teacher.mark ?? (teacher.markRange ? `${teacher.markRange.min}–${teacher.markRange.max}` : result.score)
  const showAoScores = Array.isArray(result.breakdown) && result.breakdown.length > 1
  const skillReasons = result.engine?.threads ?? []

  const getGradeColour = (pct) => {
    if (pct >= 70) return '#10b981'
    if (pct >= 50) return '#f59e0b'
    return '#ef4444'
  }

  const getGradeLabel = (pct) => {
    if (pct >= 70) return 'Pass'
    if (pct >= 50) return 'Near pass'
    return 'Needs work'
  }

  const getBadgeClass = (pct) => {
    if (pct >= 70) return 'result-grade-badge grade-high'
    if (pct >= 50) return 'result-grade-badge grade-mid'
    return 'result-grade-badge grade-low'
  }

  const colour = getGradeColour(percentage)

  return (
    <div className="result-card">
      <div className="result-student-row">
        <span className="result-student-name">{studentName}</span>
        {teacher ? <span className="checked-by-you">Checked by you</span> : badge}
      </div>

      <div className="result-score-section">
        <div className="score-row">
          <span className="score-number" style={{ color: colour }}>{scoreText}</span>
          <span className="score-separator">/</span>
          <span className="score-max">{result.maxScore}</span>
          <div className="result-awarded-bands">
            {result.breakdown?.map(item => item.awardedBand && (
              <span key={item.section} className="result-awarded-band">
                {item.section} — {teacher ? levelName(teacher.level) : item.awardedBand}
                {!teacher && singleAo && couldBe ? ` (${couldBe})` : ''}
              </span>
            ))}
          </div>
          <span className={getBadgeClass(percentage)}>{getGradeLabel(percentage)}</span>
        </div>

        {teacher && (teacher.level !== teacher.suggested.level || (teacher.mark != null && teacher.mark !== teacher.suggested.mark)) && (
          <p className="result-checked-note">
            Suggested: {markText(teacher.suggested.level, teacher.suggested.mark, teacher.maxMark)}
          </p>
        )}

        <div className="progress-track">
          <div
            className="progress-fill"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(90deg, ${colour}cc, ${colour})`,
            }}
          />
        </div>
      </div>

      {result.feedback && (
        <div className="result-overall-summary">
          <div className="section-label">Overall Summary</div>
          <p className="overall-summary-text">{result.feedback}</p>
        </div>
      )}

      {result.breakdown && result.breakdown.length > 0 && (
        <div className="result-breakdown">
          <div className="section-label">Breakdown</div>
          {result.breakdown.map((item, index) => {
            const itemPct = Math.round((item.marks / item.maxMarks) * 100)
            // The mark scheme lines for the level shown: the teacher's, once checked.
            const descriptors = descriptorsForBreakdownItem(
              scheme, teacher ? { ...item, awardedBand: `Level ${teacher.level}` } : item
            )
            return (
              <div key={index} className="breakdown-item">
                <div className="breakdown-item-header">
                  <div className="breakdown-criterion">
                    {showAoScores && <span className="breakdown-name">{item.section}</span>}
                    {(item.summary || item.reason) && (
                      <p className="breakdown-summary">{item.summary || item.reason}</p>
                    )}
                    {/* One plain-English reason per skill from the marking
                        engine, in place of per-skill levels. */}
                    {!showAoScores && skillReasons.length > 0 && (
                      <ul className="breakdown-skill-reasons">
                        {skillReasons.map(skill => (
                          <li key={skill.label}>
                            <span className="breakdown-skill-label">{skill.label}</span>
                            <span>{skill.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {showAoScores && (
                    <span className="breakdown-score">{item.marks} / {item.maxMarks}</span>
                  )}
                </div>
                {showAoScores && (
                  <div className="breakdown-bar-track">
                    <div className="breakdown-bar-fill" style={{ width: `${itemPct}%` }} />
                  </div>
                )}
                {descriptors.length > 0 && (
                  <ul className="breakdown-descriptors">
                    {descriptors.map((descriptor, descriptorIndex) => {
                      const isStructured = descriptor && typeof descriptor === 'object'
                      const text = isStructured ? descriptor.text : descriptor

                      return (
                        <li key={descriptorIndex} className="breakdown-descriptor">
                          <span>{text}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ResultCard
