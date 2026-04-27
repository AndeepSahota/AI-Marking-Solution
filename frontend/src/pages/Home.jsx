import { useState, useEffect, useCallback } from 'react'
import UploadZone from '../components/UploadZone'
import ResultCard from '../components/ResultCard'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorBanner from '../components/ErrorBanner'
import { submitFiles } from '../services/api'

function Home() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasFiles, setHasFiles] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Stable callback for UploadZone — won't trigger its useEffect on re-renders
  const handleFilesChange = useCallback((has) => setHasFiles(has), [])

  // Re-show the banner whenever files first appear (new upload session)
  useEffect(() => {
    if (hasFiles) setBannerDismissed(false)
  }, [hasFiles])

  // Register the browser's native leave/refresh guard while work is in progress
  useEffect(() => {
    if (!hasFiles && !loading) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = '' // required by Chrome to trigger the native dialog
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasFiles, loading])

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

  const showBanner = hasFiles && !bannerDismissed

  return (
    <>
      {showBanner && (
        <div className="refresh-warning" role="alert">
          <div className="refresh-warning-text">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Refreshing or leaving the page will remove your current work
          </div>
          <button
            className="refresh-warning-dismiss"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss warning"
          >
            ✕
          </button>
        </div>
      )}

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

        <UploadZone
          onSubmit={handleSubmit}
          disabled={loading}
          onFilesChange={handleFilesChange}
          hasResult={!!result}
          onReset={() => { setResult(null); setError(null) }}
        />

        {loading && <LoadingSpinner />}
        {error && <ErrorBanner message={error} />}
        {result && <ResultCard result={result} />}
      </div>
    </>
  )
}

export default Home
