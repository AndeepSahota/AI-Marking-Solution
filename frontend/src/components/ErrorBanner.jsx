function ErrorBanner({ message }) {
  return (
    <div className="error-banner">
      <div className="error-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="error-body">
        <span className="error-title">Something went wrong</span>
        <span className="error-message">{message}</span>
      </div>
    </div>
  )
}

export default ErrorBanner
