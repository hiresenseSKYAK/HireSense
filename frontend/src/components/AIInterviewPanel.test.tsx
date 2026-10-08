// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIInterviewPanel from './AIInterviewPanel'
import { startInterview, submitInterviewAnswer } from '../api/interview'

vi.mock('../api/interview', () => ({ startInterview: vi.fn(), submitInterviewAnswer: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const resume = { name: null, email: null, phone: null, skills: ['Python'], education: [], experience: [], projects: [], leadership: [], experience_entries: [], project_entries: [], leadership_entries: [] }
const q = { session_id: 1, session_token: 'guest', question_id: 'q1', question_index: 1, total_questions: 3, prompt: 'Describe your Python project.', focus_area: 'Technical', tips: [], source: 'fallback' as const }
const feedback = { score: 40, benchmark: 'Needs work', summary: 'Add an outcome.', strengths: [], improvements: ['Be specific'], source: 'fallback' as const }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(startInterview).mockResolvedValue(q)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })
async function render(jobId = 1) {
  await act(async () => root.render(<AIInterviewPanel jobId={jobId} jobTitle="Engineer" company="Acme" resumeData={resume} />))
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent === text)
  expect(button).toBeDefined()
  await act(async () => button?.click())
}
async function typeAnswer(text: string) {
  const textarea = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('AIInterviewPanel', () => {
  it('offers setup options and displays follow-up feedback then final debrief', async () => {
    await render()
    expect(container.textContent).toContain('Core questions')
    await click('Start Interview')
    expect(startInterview).toHaveBeenCalledWith(1, resume, { mode: 'mixed', question_count: 5 })
    expect(container.textContent).toContain('Guided practice question')
    vi.mocked(submitInterviewAnswer).mockResolvedValueOnce({ session_id: 1, question_index: 1, is_complete: false, feedback, next_question: { ...q, question_id: 'q1-followup', prompt: 'What changed afterward?', is_follow_up: true }, final_result: null })
    await typeAnswer('I built a parser.')
    await click('Submit Answer')
    expect(submitInterviewAnswer).toHaveBeenCalledWith(1, 'I built a parser.', 'q1', 'guest')
    expect(container.textContent).toContain('Heuristic practice feedback')
    await click('Continue to Next Question')
    expect(container.textContent).toContain('Follow-up Question')
    vi.mocked(submitInterviewAnswer).mockResolvedValueOnce({ session_id: 1, question_index: 2, is_complete: true, feedback, next_question: null, final_result: { final_score: 60, overall_summary: 'Practice outcomes.', top_strengths: [], next_steps: ['Measure impact.'], practice_questions: ['What changed afterward?'] } })
    await typeAnswer('It reduced errors.')
    await click('Submit Answer')
    expect(container.textContent).toContain('Final Interview Results')
    expect(container.textContent).toContain('Practice next')
    await click('Start New Interview')
    expect(container.textContent).toContain('Start Interview')
  })

  it('retains the answer on failure so the same question can be retried', async () => {
    await render()
    await click('Start Interview')
    vi.mocked(submitInterviewAnswer).mockRejectedValueOnce(new Error('Connection failed. Retry.'))
    await typeAnswer('My example')
    await click('Submit Answer')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection failed')
    expect(container.querySelector('textarea')?.value).toBe('My example')
    expect(container.querySelector('button.btn-primary')?.hasAttribute('disabled')).toBe(false)
  })

  it('ignores a late response after switching jobs', async () => {
    let resolve: (value: typeof q) => void = () => undefined
    vi.mocked(startInterview).mockImplementation(() => new Promise(r => { resolve = r }))
    await render()
    await click('Start Interview')
    await render(2)
    await act(async () => resolve(q))
    expect(container.textContent).toContain('Start Interview')
    expect(container.textContent).not.toContain(q.prompt)
  })
})
