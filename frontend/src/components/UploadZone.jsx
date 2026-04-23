import { useState, useRef } from 'react'

function DropZone({ label, hint, file, onFile, onClear, disabled }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const dropped = e.dataTransfer.files[0]
    if (dropped) onFile(dropped)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    if (!disabled) setDragging(true)
  }

  const handleClick = () => {
    if (!disabled) inputRef.current.click()
  }

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div
      className={`drop-zone${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]) }}
        disabled={disabled}
      />

      <div className="drop-zone-icon">
        {file ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        )}
      </div>

      {file ? (
        <div className="file-info" onClick={(e) => e.stopPropagation()}>
          <div className="file-name-tag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span title={file.name}>{file.name}</span>
          </div>
          <span className="drop-zone-hint">{formatSize(file.size)}</span>
          <button
            className="remove-btn"
            onClick={(e) => { e.stopPropagation(); onClear() }}
          >
            Remove file
          </button>
        </div>
      ) : (
        <>
          <div className="drop-zone-label">{label}</div>
          <div className="drop-zone-hint">{hint}</div>
          <div className="drop-zone-cta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Browse or drop
          </div>
        </>
      )}
    </div>
  )
}

function UploadZone({ onSubmit, disabled }) {
  const [studentWork, setStudentWork] = useState(null)
  const [markScheme, setMarkScheme] = useState(null)

  const ready = studentWork && markScheme

  const handleSubmit = () => {
    if (!ready || disabled) return
    onSubmit(studentWork, markScheme)
  }

  return (
    <div className="upload-panel">
      <div className="upload-zones">
        <DropZone
          label="Student Work"
          hint="Image or PDF of the student's written answer"
          file={studentWork}
          onFile={setStudentWork}
          onClear={() => setStudentWork(null)}
          disabled={disabled}
        />
        <DropZone
          label="Mark Scheme"
          hint="Image or PDF of the official mark scheme"
          file={markScheme}
          onFile={setMarkScheme}
          onClear={() => setMarkScheme(null)}
          disabled={disabled}
        />
      </div>

      <button
        className="submit-btn"
        onClick={handleSubmit}
        disabled={disabled || !ready}
      >
        {disabled ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Marking in progress…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Submit for Marking
          </>
        )}
      </button>
    </div>
  )
}

export default UploadZone
