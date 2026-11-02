import test from 'node:test'
import assert from 'node:assert/strict'
import { teacherFacingEnvelope, teacherFacingResult, teacherText } from '../src/services/teacherFacing.js'

// Made-up sentences, not real student work.
test('teacherText drops sentences with level lines, codes or engine words', () => {
    assert.equal(
        teacherText('The answer explains the storm. This meets the requirement for Level 2. It links ao4-3a to panic.'),
        'The answer explains the storm.'
    )
    assert.equal(teacherText('Ideas about the sea.: Level 2 Judgement.: Level 1'), '')
    assert.equal(teacherText('Marked by independent specialists, one per thread: Level 1.'), '')
    assert.equal(teacherText('Uses the quote well (matches: appropriate and relevant).'), 'Uses the quote well.')
    assert.equal(teacherText('A clear "personal" view! Calibrated score 2.4.'), 'A clear "personal" view!')
    assert.equal(teacherText(undefined), '')
})

test('teacherFacingResult keeps the overall level and quotes, drops codes', () => {
    const result = teacherFacingResult({
        score: 5, maxScore: 15,
        summary: 'Combined by a calibrated score: Level 2.',
        featuredEvidenceByThread: { a: ['e1'] },
        breakdown: [{
            section: 'AO4', awardedBand: 'Level 2', marks: 5, maxMarks: 15, summary: 'Skill one.: Level 2',
            reason: 'Needs more detail. Level 3 needs analysis.',
            evidenceSupportingAwardedBand: [{ descriptorId: 'ao4-2a', judgement: 'Meets Level 2.' }],
            nextBandRequirementNotMet: [{ descriptorId: 'ao4-3a' }],
        }],
        evidence: [{ evidenceId: 'e1', quote: 'the waves rose', descriptorIds: ['ao4-2a'], summary: 'Describes the sea. Meets Level 2.', explanation: 'Describes the sea.' }],
        actionableSteps: ['Add a quotation.', 'Reach Level 3 by analysing.'],
        studentOcrText: 'kept',
    })
    assert.equal(result.summary, '')
    assert.equal('featuredEvidenceByThread' in result, false)
    assert.deepEqual(result.breakdown[0], { section: 'AO4', awardedBand: 'Level 2', marks: 5, maxMarks: 15, summary: '', reason: 'Needs more detail.' })
    assert.deepEqual(result.evidence[0], { evidenceId: 'e1', quote: 'the waves rose', summary: 'Describes the sea.', explanation: 'Describes the sea.' })
    assert.deepEqual(result.actionableSteps, ['Add a quotation.'])
    assert.equal(result.studentOcrText, 'kept')
})

test('teacherFacingEnvelope also strips engine internals, and passes failures through', () => {
    const envelope = teacherFacingEnvelope({ status: 'complete', result: { engine: { level: 2, fineScore: 2.2, schemeKey: 'x', threads: [] }, evidence: [] } })
    assert.deepEqual(envelope.result.engine, { level: 2, threads: [] })
    assert.deepEqual(
        teacherFacingEnvelope({ status: 'invalid', reason: 'Using specialist marking for AO4', modelResult: { evidence: [] } }),
        { status: 'invalid', reason: '' }
    )
    assert.equal(teacherFacingEnvelope(null), null)
    assert.equal(teacherFacingResult(null), null)
})
