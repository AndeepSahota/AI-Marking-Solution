function LoadingSpinner() {
  return (
    <div className="loading-container">
      <div className="spinner-ring" />
      <div>
        <p className="loading-label">Analysing submission<span className="dots" /></p>
        <p className="loading-sublabel">This usually takes a few seconds</p>
      </div>
    </div>
  )
}

export default LoadingSpinner
