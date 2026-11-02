// Finds evidence quotes in a student's essay and splits the text into plain
// and highlighted runs. Shared by AggregationEvidenceEssay (Feedback page)
// and the teacher review screen.

function normalise(value) {
  return String(value ?? '')
    .replace(/[‘’ʼ“”«»'"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNormalisedText(text, { omitStruckThroughText = false } = {}) {
  const characters = []
  const sourceIndexes = []
  let previousWasSpace = false
  let insideStruckThroughText = false

  for (let index = 0; index < text.length; index += 1) {
    if (omitStruckThroughText && text.slice(index, index + 2) === '~~') {
      insideStruckThroughText = !insideStruckThroughText
      index += 1
      continue
    }
    if (insideStruckThroughText) continue

    let character = text[index]
    if (/[‘’ʼ“”«»'"]/.test(character)) character = '"'

    if (/\s/.test(character)) {
      if (!previousWasSpace) {
        characters.push(' ')
        sourceIndexes.push(index)
        previousWasSpace = true
      }
    } else {
      characters.push(character)
      sourceIndexes.push(index)
      previousWasSpace = false
    }
  }

  return { text: characters.join(''), sourceIndexes }
}

function overlaps(range, ranges) {
  const rangeEnd = range.position + range.length
  return ranges.some(existing => (
    range.position < existing.position + existing.length && rangeEnd > existing.position
  ))
}

function quoteMatchVariants(quote) {
  const exactQuote = String(quote ?? '')
  if (!exactQuote) return []

  const variants = [exactQuote]
  // The model can append one punctuation character that is not present in the
  // OCR source (most commonly a full stop or a closing quotation mark). Keep
  // this fallback narrow: never discard a letter, number, or whitespace.
  if (exactQuote.length > 1 && /[.,!?;:'"‘’“”«»)]$/u.test(exactQuote)) {
    variants.push(exactQuote.slice(0, -1))
  }

  return variants
}

function findAvailableMatch(text, quote, normalisedSources, usedRanges) {
  const quoteVariants = quoteMatchVariants(quote)
  if (quoteVariants.length === 0) return null

  for (const quoteVariant of quoteVariants) {
    let searchFrom = 0
    while (searchFrom < text.length) {
      const position = text.indexOf(quoteVariant, searchFrom)
      if (position === -1) break
      const candidate = { position, length: quoteVariant.length }
      if (!overlaps(candidate, usedRanges)) return candidate
      searchFrom = position + 1
    }
  }

  for (const quoteVariant of quoteVariants) {
    const normalisedQuote = normalise(quoteVariant)
    if (!normalisedQuote) continue

    for (const source of normalisedSources) {
      for (const [haystack, needle] of [
        [source.text, normalisedQuote],
        [source.text.toLowerCase(), normalisedQuote.toLowerCase()],
      ]) {
        let searchPosition = 0
        while (searchPosition < haystack.length) {
          const normalisedPosition = haystack.indexOf(needle, searchPosition)
          if (normalisedPosition === -1) break

          const normalisedEnd = normalisedPosition + needle.length - 1
          const position = source.sourceIndexes[normalisedPosition]
          const end = source.sourceIndexes[normalisedEnd] + 1
          const candidate = { position, length: end - position }
          if (!overlaps(candidate, usedRanges)) return candidate
          searchPosition = normalisedPosition + 1
        }
      }
    }
  }

  return null
}

// cards: [{ id, quote, ... }]. Each card gets the position of its quote in
// the text (or null), and the text is split into plain and highlighted runs.
export function buildEvidenceSegments(text, cards) {
  const normalisedSources = [
    buildNormalisedText(text),
    buildNormalisedText(text, { omitStruckThroughText: true }),
  ]
  // Prefer a free occurrence (a phrase the student wrote twice gets both
  // highlighted), but a quote that overlaps one already placed -- the same
  // sentence cited for two skills -- still counts as found.
  const usedRanges = []
  const positionedCards = cards.map(card => {
    const match = findAvailableMatch(text, card.quote, normalisedSources, usedRanges)
      ?? findAvailableMatch(text, card.quote, normalisedSources, [])
    if (!match) return { ...card, match: null }
    usedRanges.push(match)
    return { ...card, match }
  })

  // Overlapping quotes merge into one highlight that carries every card.
  const groups = []
  const matched = positionedCards
    .filter(card => card.match)
    .sort((left, right) => left.match.position - right.match.position)
  for (const card of matched) {
    const start = card.match.position
    const end = start + card.match.length
    const last = groups.at(-1)
    if (last && start < last.end) {
      last.end = Math.max(last.end, end)
      last.cards.push(card)
    } else {
      groups.push({ start, end, cards: [card] })
    }
  }

  const segments = []
  let cursor = 0
  for (const group of groups) {
    if (group.start > cursor) segments.push({ type: 'text', content: text.slice(cursor, group.start) })
    segments.push({ type: 'highlight', content: text.slice(group.start, group.end), cards: group.cards })
    cursor = group.end
  }
  if (cursor < text.length) segments.push({ type: 'text', content: text.slice(cursor) })

  return { cards: positionedCards, segments }
}
