import { useState } from 'react'
import UploadZone from '../components/UploadZone'
import ResultCard from '../components/ResultCard'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorBanner from '../components/ErrorBanner'
import { submitFiles } from '../services/api'

function Home() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (studentWork, markScheme) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const data = await submitFiles(studentWork, markScheme)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-eyebrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          AI POWERED ASSISTANT
        </div>
        <h1 className="hero-title">Instant, intelligent marking</h1>
        <p className="hero-subtitle">
          Upload a student's submission alongside a mark scheme and get detailed feedback in seconds.
        </p>
      </div>

      <UploadZone onSubmit={handleSubmit} disabled={loading} />

      {loading && <LoadingSpinner />}
      {error && <ErrorBanner message={error} />}
      {result && <ResultCard result={result} />}
    </div>
  )
}

export default Home
