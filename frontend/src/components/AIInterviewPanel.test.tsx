// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIInterviewPanel from './AIInterviewPanel'
import { getInterviewSession, interviewRecoveryKey, InterviewApiError, startInterview, submitInterviewAnswer } from '../api/interview'

vi.mock('../api/interview', async () => ({ ...(await vi.importActual('../api/interview')), startInterview: vi.fn(), submitInterviewAnswer: vi.fn(), getInterviewSession: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const resume = { name: null, email: null, phone: null, skills: ['Python'], education: [], experience: [], projects: [], leadership: [], experience_entries: [], project_entries: [], leadership_entries: [] }
const q = { session_id: 1, question_id: 'q1', question_index: 1, total_questions: 3, prompt: 'Describe your Python project.', focus_area: 'Technical', tips: [], source: 'fallback' as const }
const feedback = { score: 40, benchmark: 'Needs work', summary: 'Add an outcome.', strengths: [], improvements: ['Be specific'], source: 'fallback' as const }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  localStorage.setItem('hiresense_auth_session', JSON.stringify({ token: 'account-token', user: { id: 1 } }))
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
    expect(container.textContent).toContain('Total questions')
    await click('Start Interview')
    expect(startInterview).toHaveBeenCalledWith(1, resume, { mode: 'mixed', question_count: 5 })
    expect(container.textContent).toContain('Guided practice question')
    vi.mocked(submitInterviewAnswer).mockResolvedValueOnce({ session_id: 1, question_index: 1, is_complete: false, feedback, next_question: { ...q, question_id: 'q1-followup', prompt: 'What changed afterward?', is_follow_up: true }, final_result: null })
    await typeAnswer('I built a parser.')
    await click('Submit Answer')
    expect(submitInterviewAnswer).toHaveBeenCalledWith(1, 'I built a parser.', 'q1')
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
  it.each(['behavioral', 'technical', 'mixed', 'role_specific'] as const)('selects %s mode and each supported count', async (mode) => {
    await render()
    for (const count of [3, 5, 8]) {
      const selects = container.querySelectorAll('select')
      await act(async () => {
        selects[0].value = mode
        selects[0].dispatchEvent(new Event('change', { bubbles: true }))
        selects[1].value = String(count)
        selects[1].dispatchEvent(new Event('change', { bubbles: true }))
      })
      await click('Start Interview')
      expect(startInterview).toHaveBeenLastCalledWith(1, resume, { mode, question_count: count })
      await click('Restart')
    }
  })

  it('shows starting status and prevents a double click', async () => {
    let resolve: (value: typeof q) => void = () => undefined
    vi.mocked(startInterview).mockImplementation(() => new Promise(r => { resolve = r }))
    await render()
    const button = container.querySelector('button.btn-primary') as HTMLButtonElement
    await act(async () => { button.click(); button.click() })
    expect(startInterview).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    expect(container.textContent).toContain('Preparing questions')
    await act(async () => resolve(q))
  })

  it('supports start error and retry', async () => {
    vi.mocked(startInterview).mockRejectedValueOnce(new Error('Job service unavailable. Retry.')).mockResolvedValueOnce(q)
    await render()
    await click('Start Interview')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unavailable')
    await click('Start Interview')
    expect(container.textContent).toContain(q.prompt)
  })

  it('shows missing resume state', async () => {
    await act(async () => root.render(<AIInterviewPanel jobId={1} jobTitle="Engineer" company="Acme" resumeData={null} />))
    expect(container.textContent).toContain('Upload a resume first')
    expect(startInterview).not.toHaveBeenCalled()
  })

  it('shows submitting status, prevents duplicates and preserves unsupported dictation', async () => {
    let resolve: (value: Awaited<ReturnType<typeof submitInterviewAnswer>>) => void = () => undefined
    vi.mocked(submitInterviewAnswer).mockImplementation(() => new Promise(r => { resolve = r }))
    await render()
    await click('Start Interview')
    expect((container.querySelector('[aria-label="Start voice input"]') as HTMLButtonElement).disabled).toBe(true)
    await typeAnswer('My example')
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Submit Answer')!
    await act(async () => { button.click(); button.click() })
    expect(submitInterviewAnswer).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Evaluating your answer')
    expect(container.querySelector('textarea')?.disabled).toBe(true)
    await act(async () => resolve({ session_id: 1, question_index: 1, is_complete: false, feedback, next_question: { ...q, question_id: 'q2', question_index: 2 }, final_result: null }))
  })

  it.each([401, 404, 410])('offers recovery actions for terminal session error %s', async (status) => {
    await render()
    await click('Start Interview')
    vi.mocked(submitInterviewAnswer).mockRejectedValueOnce(new InterviewApiError('This session is unavailable.', status))
    await typeAnswer('Keep my draft')
    await click('Submit Answer')
    expect(container.querySelector('textarea')?.value).toBe('Keep my draft')
    expect(container.textContent).toContain('Start New Interview')
    if (status === 401) expect(container.querySelector('a[href="/login"]')).not.toBeNull()
    await click('Start New Interview')
    expect(container.textContent).toContain('Start Interview')
  })

  it('recovers an active owned interview after a refresh', async () => {
    sessionStorage.setItem(interviewRecoveryKey(1, resume)!, '1')
    vi.mocked(getInterviewSession).mockResolvedValue({ session_id: 1, job_id: 1, status: 'in_progress', mode: 'mixed', total_questions: 3, current_question: { ...q, question_id: 'q2', question_index: 2 }, last_response: null })
    await render()
    expect(getInterviewSession).toHaveBeenCalledWith(1)
    expect(container.textContent).toContain('Q2/3')
    expect(container.textContent).toContain(q.prompt)
  })

  it('recovers a completed debrief and restart clears recovery state', async () => {
    const key = interviewRecoveryKey(1, resume)!
    sessionStorage.setItem(key, '1')
    vi.mocked(getInterviewSession).mockResolvedValue({ session_id: 1, job_id: 1, status: 'completed', mode: 'mixed', total_questions: 3, current_question: null, last_response: { session_id: 1, question_index: 3, is_complete: true, feedback, next_question: null, final_result: { final_score: 60, overall_summary: 'Recovered debrief.', top_strengths: [], next_steps: [] } } })
    await render()
    expect(container.textContent).toContain('Recovered debrief')
    await click('Start New Interview')
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('keeps a transient recovery failure retryable', async () => {
    sessionStorage.setItem(interviewRecoveryKey(1, resume)!, '1')
    vi.mocked(getInterviewSession).mockRejectedValueOnce(new Error('Network failed.')).mockResolvedValueOnce({ session_id: 1, job_id: 1, status: 'in_progress', mode: 'mixed', total_questions: 3, current_question: q, last_response: null })
    await render()
    expect(container.textContent).toContain('Retry Recovery')
    expect(sessionStorage.getItem(interviewRecoveryKey(1, resume)!)).toBe('1')
    await click('Retry Recovery')
    expect(container.textContent).toContain(q.prompt)
  })

  it('keeps the active draft when a parent supplies the same career context again', async () => {
    await render()
    await click('Start Interview')
    await typeAnswer('Keep this answer')
    await act(async () => root.render(<AIInterviewPanel jobId={1} jobTitle="Engineer" company="Acme" resumeData={{ ...resume }} />))
    expect(container.querySelector('textarea')?.value).toBe('Keep this answer')
    expect(getInterviewSession).not.toHaveBeenCalled()
  })

})
