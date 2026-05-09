const PIPELINE_STAGES = [
    { key: 'upload',   label: 'Files received by server' },
    { key: 'security', label: 'Security validation' },
    { key: 'ocr_sw',   label: 'OCR — Student Work' },
    { key: 'result',   label: 'Result ready' },
]

function StageRow({ label, status, detail, meta, subStages, errorDetail }) {
    return (
        <div className={`flow-stage flow-stage--${status}`}>
            <div className="flow-stage-header">
                <span className="flow-stage-icon">
                    {status === 'done'    && '✓'}
                    {status === 'active'  && <span className="flow-spinner" />}
                    {status === 'pending' && '○'}
                    {status === 'error'   && '✗'}
                </span>
                <span className="flow-stage-label">{label}</span>
                {detail && <span className="flow-stage-detail">{detail}</span>}
            </div>

            {/* Image / file meta — dims, chars, page count */}
            {meta && (
                <div className="flow-meta-row">
                    {meta.file_type && (
                        <span className="flow-meta-tag">{meta.file_type}</span>
                    )}
                    {meta.page_count != null && (
                        <span className="flow-meta-tag">{meta.page_count} page{meta.page_count === 1 ? '' : 's'}</span>
                    )}
                    {meta.pages?.[0] && (
                        <span className="flow-meta-tag">
                            {meta.pages[0].original_width}×{meta.pages[0].original_height}
                            {meta.pages[0].downscaled && (
                                <> → {meta.pages[0].model_width}×{meta.pages[0].model_height} <span className="flow-meta-warn">↓ downscaled</span></>
                            )}
                        </span>
                    )}
                    {meta.total_chars != null && (
                        <span className="flow-meta-tag">{meta.total_chars} chars extracted</span>
                    )}
                </div>
            )}

            {/* Per-page OCR sub-stages with dims + char count */}
            {subStages?.length > 0 && (
                <div className="flow-sub-stages">
                    {subStages.map((s, i) => (
                        <div key={i} className="flow-sub-stage">
                            <span className="flow-sub-icon">↳</span>
                            <span className="flow-sub-label">{s.label}</span>
                            {s.modelWidth && (
                                <span className="flow-sub-dims">{s.modelWidth}×{s.modelHeight}</span>
                            )}
                            {s.charCount != null && (
                                <span className="flow-sub-chars">{s.charCount} chars</span>
                            )}
                            <span className="flow-sub-ms">{s.ms} ms</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Error detail row — shows code + body snippet */}
            {errorDetail && (
                <div className="flow-error-detail">
                    {errorDetail.code && <span className="flow-error-code">{errorDetail.code}</span>}
                    {errorDetail.detail && <span className="flow-error-body">{errorDetail.detail}</span>}
                </div>
            )}
        </div>
    )
}

// loading=true  → show live pipeline progress
// result        → show completed pipeline with OCR stage breakdowns
// error         → show error state with detail
export default function FlowPanel({ loading, result, error }) {
    if (!loading && !result && !error) return null

    const ocrStages = result?._ocrStages
    const ocrMeta   = result?._ocrMeta

    const stages = PIPELINE_STAGES.map(({ key, label }) => {
        if (loading) {
            if (key === 'upload' || key === 'security') return { key, label, status: 'done' }
            if (key === 'ocr_sw') return { key, label, status: 'active', detail: 'processing…' }
            return { key, label, status: 'pending' }
        }

        if (error) {
            if (key === 'result') {
                return {
                    key, label,
                    status:      'error',
                    detail:      error.message,
                    errorDetail: (error.detail || error.code) ? { code: error.code, detail: error.detail } : null,
                }
            }
            return { key, label, status: 'done' }
        }

        // Result available
        if (key === 'ocr_sw') {
            const swRawStages = ocrStages?.studentWork ?? []
            const swMeta      = ocrMeta?.studentWork

            // Merge page meta into sub-stage entries so dims + char count display inline
            const subStages = swRawStages.map((s, i) => {
                const pageMeta = swMeta?.pages?.[i]
                return {
                    ...s,
                    modelWidth:  pageMeta?.model_width,
                    modelHeight: pageMeta?.model_height,
                    charCount:   pageMeta?.char_count,
                }
            })

            const totalMs = subStages.reduce((acc, s) => acc + s.ms, 0)

            return {
                key, label,
                status:    'done',
                detail:    `${(totalMs / 1000).toFixed(1)} s`,
                meta:      swMeta,
                subStages,
            }
        }

        if (key === 'result') return { key, label, status: 'done' }
        return { key, label, status: 'done' }
    })

    return (
        <div className="flow-panel">
            <div className="flow-panel-title">Processing Pipeline</div>
            {stages.map(s => (
                <StageRow
                    key={s.key}
                    label={s.label}
                    status={s.status}
                    detail={s.detail}
                    meta={s.meta}
                    subStages={s.subStages}
                    errorDetail={s.errorDetail}
                />
            ))}
        </div>
    )
}
