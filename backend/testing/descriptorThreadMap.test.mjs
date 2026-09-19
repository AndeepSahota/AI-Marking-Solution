import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedDescriptorThreads } from '../src/services/descriptorThreadMap.js'

const extraction = {
    questions: {
        'Question 1': {
            assessment_objectives: {
                AO4: {
                    threads: {
                        a: {
                            thread_id: 'ao4-thread-a',
                            thread_description: 'Ideas and themes',
                            levels: [
                                { descriptor_id: 'ao4-1a', band: 'Level 1', text: 'Describe ideas.' },
                                { descriptor_id: 'ao4-3a', band: 'Level 3', text: 'Explain ideas.' },
                            ],
                        },
                        b: {
                            thread_id: 'ao4-thread-b',
                            levels: [{ descriptor_id: 'ao4-3b', band: 'Level 3', text: 'Informed judgement.' }],
                        },
                    },
                },
                AO5: {
                    threads: {
                        a: {
                            thread_id: 'ao5-thread-a',
                            levels: [{ descriptor_id: 'ao5-2a', band: 'Level 2', text: 'Write clearly.' }],
                        },
                    },
                },
            },
        },
        'Question 2': {
            assessment_objectives: {
                AO4: {
                    threads: {
                        c: {
                            thread_id: 'ao4-thread-c',
                            levels: [{ descriptor_id: 'ao4-2c', band: 'Level 2', text: 'Another question.' }],
                        },
                    },
                },
            },
        },
    },
}

test('returns a compact mapping for every level and AO of only the selected question', () => {
    assert.deepEqual(selectedDescriptorThreads(JSON.stringify(extraction), 'Question 1'), {
        'ao4-1a': 'ao4-thread-a',
        'ao4-3a': 'ao4-thread-a',
        'ao4-3b': 'ao4-thread-b',
        'ao5-2a': 'ao5-thread-a',
    })
})

test('returns no mapping for missing or invalid stored extraction', () => {
    assert.deepEqual(selectedDescriptorThreads(JSON.stringify(extraction), 'Question 3'), {})
    assert.deepEqual(selectedDescriptorThreads('{invalid', 'Question 1'), {})
    assert.deepEqual(selectedDescriptorThreads('', 'Question 1'), {})
})

test('rejects ambiguous descriptor-to-thread mappings', () => {
    const invalid = structuredClone(extraction)
    invalid.questions['Question 1'].assessment_objectives.AO4.threads.b.levels.push({
        descriptor_id: 'ao4-1a',
    })
    assert.deepEqual(selectedDescriptorThreads(invalid, 'Question 1'), {})
})
