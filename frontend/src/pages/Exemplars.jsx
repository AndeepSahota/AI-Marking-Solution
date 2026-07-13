import { useState, useEffect, useRef } from 'react'
import { getExemplars, addExemplar, deleteExemplar } from '../services/api'

function Exemplars() {
  const [exemplars,   setExemplars]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState(null)
  const [success,     setSuccess]     = useState(null)

  const [file,        setFile]        = useState(null)
  const [qNumber,     setQNumber]     = useState('')
  const [score,       setScore]       = useState('')
  const [maxMarks,    setMaxMarks]    = useState('')
  const [band,        setBand]        = useState('')
  const [source,      setSource]      = useState('')

  const fileRef = useRef(null)

  const load = () => {
    setLoading(true)
    getExemplars()
      .then(setExemplars)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file)     return setError('Please select an essay file.')
    if (!qNumber)  return setError('Question number is required.')
    if (!score)    return setError('Score is required.')
    if (!maxMarks) return setError('Max marks is required.')

    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      await addExemplar(file, qNumber, parseInt(score), parseInt(maxMarks), band ? parseInt(band) : null, source)
      setSuccess('Exemplar added successfully.')
      setFile(null); setQNumber(''); setScore(''); setMaxMarks(''); setBand(''); setSource('')
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this exemplar?')) return
    try {
      await deleteExemplar(id)
      setExemplars(prev => prev.filter(e => e.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page exemplars-page">
      <div className="exemplars-header">
        <h1 className="exemplars-title">RAG Exemplars</h1>
        <p className="exemplars-subtitle">
          Upload official AQA marked responses. AIMIRA retrieves the 3 most similar
          exemplars when marking a student essay and uses them to calibrate band decisions.
        </p>
      </div>

      <div className="exemplars-layout">
        <section className="exemplar-form-card">
          <h2 className="exemplar-form-title">Add exemplar</h2>
          <form onSubmit={handleSubmit}>
            <div className="exemplar-field">
              <label className="exemplar-label">Essay file (PDF or image)</label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="exemplar-file-input"
                onChange={e => { setFile(e.target.files[0] ?? null); setError(null) }}
              />
            </div>

            <div className="exemplar-field-row">
              <div className="exemplar-field">
                <label className="exemplar-label">Question number</label>
                <input
                  type="text"
                  className="exemplar-input"
                  placeholder="e.g. Q4"
                  value={qNumber}
                  onChange={e => { setQNumber(e.target.value); setError(null) }}
                />
              </div>
              <div className="exemplar-field">
                <label className="exemplar-label">Band <span className="exemplar-optional">(optional)</span></label>
                <input
                  type="number"
                  className="exemplar-input"
                  placeholder="1–5"
                  min="1" max="5"
                  value={band}
                  onChange={e => { setBand(e.target.value); setError(null) }}
                />
              </div>
            </div>

            <div className="exemplar-field-row">
              <div className="exemplar-field">
                <label className="exemplar-label">Score awarded</label>
                <input
                  type="number"
                  className="exemplar-input"
                  placeholder="e.g. 14"
                  min="0"
                  value={score}
                  onChange={e => { setScore(e.target.value); setError(null) }}
                />
              </div>
              <div className="exemplar-field">
                <label className="exemplar-label">Max marks</label>
                <input
                  type="number"
                  className="exemplar-input"
                  placeholder="e.g. 20"
                  min="1"
                  value={maxMarks}
                  onChange={e => { setMaxMarks(e.target.value); setError(null) }}
                />
              </div>
            </div>

            <div className="exemplar-field">
              <label className="exemplar-label">Source <span className="exemplar-optional">(optional)</span></label>
              <input
                type="text"
                className="exemplar-input"
                placeholder="e.g. AQA June 2024 Exemplar"
                value={source}
                onChange={e => { setSource(e.target.value); setError(null) }}
              />
            </div>

            {error   && <p className="exemplar-error">{error}</p>}
            {success && <p className="exemplar-success">{success}</p>}

            <button className="exemplar-submit-btn" type="submit" disabled={submitting}>
              {submitting ? 'Uploading & embedding…' : 'Add exemplar'}
            </button>
          </form>
        </section>

        <section className="exemplar-list-card">
          <h2 className="exemplar-form-title">Stored exemplars ({exemplars.length})</h2>
          {loading ? (
            <p className="exemplar-loading">Loading…</p>
          ) : exemplars.length === 0 ? (
            <p className="exemplar-empty">No exemplars yet. Add one using the form.</p>
          ) : (
            <div className="exemplar-list">
              {exemplars.map(ex => (
                <div key={ex.id} className="exemplar-row">
                  <div className="exemplar-row-meta">
                    <span className="exemplar-row-qnum">{ex.question_number}</span>
                    <span className="exemplar-row-score">{ex.score}/{ex.max_marks}</span>
                    {ex.band && <span className="exemplar-row-band">Band {ex.band}</span>}
                  </div>
                  <div className="exemplar-row-source">{ex.source || 'No source'}</div>
                  <button
                    className="exemplar-delete-btn"
                    onClick={() => handleDelete(ex.id)}
                  >Delete</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default Exemplars
