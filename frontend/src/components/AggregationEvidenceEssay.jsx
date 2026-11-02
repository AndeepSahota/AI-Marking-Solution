import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderOcrText } from '../utils/renderOcrText'
import { buildEvidenceSegments } from '../utils/evidenceSegments'

const COLORS = [
  { bg: 'rgba(99,102,241,0.20)', border: '#818cf8' },
  { bg: 'rgba(245,158,11,0.20)', border: '#fbbf24' },
  { bg: 'rgba(16,185,129,0.20)', border: '#34d399' },
  { bg: 'rgba(236,72,153,0.20)', border: '#f472b6' },
  { bg: 'rgba(59,130,246,0.20)', border: '#60a5fa' },
  { bg: 'rgba(139,92,246,0.20)', border: '#a78bfa' },
]

function descriptorIdsForEvidence(evidence) {
  const descriptorIds = evidence.descriptorIds ?? evidence.descriptor_ids
  if (Array.isArray(descriptorIds)) {
    return [...new Set(descriptorIds.filter(Boolean).map(String))]
  }

  const legacyDescriptorId = evidence.descriptorId ?? evidence.descriptor_id
  return legacyDescriptorId ? [String(legacyDescriptorId)] : []
}

function flattenAggregationEvidence(aggregationResult) {
  return (aggregationResult?.evidence ?? [])
    .map((evidence, evidenceIndex) => ({
      id: evidence.evidenceId ?? evidence.evidence_id ?? `aggregation-evidence-${evidenceIndex}`,
      quote: evidence.quote ?? '',
      explanation: evidence.explanation ?? '',
      summary: evidence.summary ?? '',
      descriptorIds: descriptorIdsForEvidence(evidence),
    }))
    .map((card, colorIndex) => ({ ...card, colorIndex }))
}

function AggregationEvidenceEssay({ text, aggregationResult }) {
  const baseCards = useMemo(
    () => flattenAggregationEvidence(aggregationResult),
    [aggregationResult]
  )
  const { cards, segments } = useMemo(
    () => buildEvidenceSegments(text, baseCards),
    [text, baseCards]
  )
  const containerRef = useRef(null)
  const highlightRefs = useRef(new Map())
  const cardRefs = useRef(new Map())
  const [lines, setLines] = useState([])

  useLayoutEffect(() => {
    const updateLines = () => {
      const container = containerRef.current
      if (!container || window.innerWidth <= 900) {
        setLines([])
        return
      }

      const containerBox = container.getBoundingClientRect()
      const nextLines = cards.flatMap(card => {
        if (!card.match) return []
        const highlight = highlightRefs.current.get(card.id)
        const evidenceCard = cardRefs.current.get(card.id)
        if (!highlight || !evidenceCard) return []

        const highlightBox = highlight.getBoundingClientRect()
        const evidenceCardBox = evidenceCard.getBoundingClientRect()
        const isLeft = card.colorIndex % 2 === 0
        const direction = isLeft ? -1 : 1
        const startX = (isLeft ? highlightBox.left : highlightBox.right) - containerBox.left + (direction * 3)
        const startY = highlightBox.top - containerBox.top + (highlightBox.height / 2)
        const endX = (isLeft ? evidenceCardBox.right : evidenceCardBox.left) - containerBox.left - (direction * 6)
        const endY = evidenceCardBox.top - containerBox.top + (evidenceCardBox.height / 2)
        const bend = Math.max(28, Math.abs(endX - startX) * 0.42)

        return [{
          id: card.id,
          color: COLORS[card.colorIndex % COLORS.length].border,
          d: `M ${startX} ${startY} C ${startX + (direction * bend)} ${startY}, ${endX - (direction * bend)} ${endY}, ${endX} ${endY}`,
        }]
      })
      setLines(nextLines)
    }

    updateLines()
    const observer = new ResizeObserver(updateLines)
    if (containerRef.current) observer.observe(containerRef.current)
    for (const card of cardRefs.current.values()) observer.observe(card)
    window.addEventListener('resize', updateLines)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateLines)
    }
  }, [cards])

  return (
    <section className="descriptor-evidence-wrap" aria-label="Marking evidence in student response">
      <div className="annotated-section-label descriptor-evidence-heading">Descriptor Evidence</div>
      <div
        className="descriptor-evidence-body descriptor-evidence-body--alternating"
        ref={containerRef}
        style={{ '--evidence-rows': Math.max(1, Math.ceil(cards.length / 2)) }}
      >
        <svg className="descriptor-evidence-connectors" aria-hidden="true">
          {lines.map(line => <path key={line.id} d={line.d} stroke={line.color} />)}
        </svg>

        <div className="descriptor-evidence-text">
          <div className="annotated-section-label">Student Response</div>
          <div className="annotated-essay-prose">
            {segments.map((segment, index) => {
              if (segment.type === 'text') {
                return <span key={index}>{renderOcrText(segment.content, `text-${index}`)}</span>
              }
              const card = segment.card
              const color = COLORS[card.colorIndex % COLORS.length]
              return (
                <span
                  key={card.id}
                  className="descriptor-evidence-highlight"
                  ref={node => {
                    if (node) highlightRefs.current.set(card.id, node)
                    else highlightRefs.current.delete(card.id)
                  }}
                  style={{ background: color.bg, borderBottomColor: color.border }}
                  title={card.descriptorIds.length > 0
                    ? `Descriptors: ${card.descriptorIds.join(', ')}`
                    : 'Descriptor unavailable'}
                >
                  {renderOcrText(segment.content, `highlight-${card.id}`)}
                  <span className="descriptor-evidence-badge" style={{ background: color.border }}>
                    {card.colorIndex + 1}
                  </span>
                </span>
              )
            })}
          </div>
        </div>

        {cards.map(card => {
            const color = COLORS[card.colorIndex % COLORS.length]
            return (
              <article
                key={card.id}
                className={`descriptor-evidence-card${card.match ? '' : ' descriptor-evidence-card--unmatched'}`}
                ref={node => {
                  if (node) cardRefs.current.set(card.id, node)
                  else cardRefs.current.delete(card.id)
                }}
                style={{
                  '--evidence-colour': color.border,
                  '--evidence-column': card.colorIndex % 2 === 0 ? 1 : 3,
                  '--evidence-row': Math.floor(card.colorIndex / 2) + 1,
                }}
              >
                <div className="descriptor-evidence-card-header">
                  <span className="descriptor-evidence-card-number" style={{ background: color.border }}>
                    {card.colorIndex + 1}
                  </span>
                  <div className="descriptor-evidence-card-ids">
                    {card.descriptorIds.length > 0 ? (
                      card.descriptorIds.map(descriptorId => (
                        <code key={descriptorId} className="descriptor-evidence-card-id">
                          {descriptorId}
                        </code>
                      ))
                    ) : (
                      <code className="descriptor-evidence-card-id">Descriptor unavailable</code>
                    )}
                  </div>
                </div>
                {card.summary ? (
                  <>
                    <div className="descriptor-evidence-judgement">
                      <span>At a glance</span>
                      <p>{card.summary}</p>
                    </div>
                    <details className="descriptor-evidence-details">
                      <summary>View evidence explanation</summary>
                      <div className="descriptor-evidence-judgement">
                        <p>{card.explanation}</p>
                      </div>
                    </details>
                  </>
                ) : card.explanation ? (
                  <div className="descriptor-evidence-judgement">
                    <span>Evidence explanation</span>
                    <p>{card.explanation}</p>
                  </div>
                ) : null}
                {!card.match && (
                  <p className="descriptor-evidence-unmatched-note">
                    This quote could not be matched in the stored student response.
                  </p>
                )}
              </article>
            )
        })}
      </div>
    </section>
  )
}

export default AggregationEvidenceEssay
