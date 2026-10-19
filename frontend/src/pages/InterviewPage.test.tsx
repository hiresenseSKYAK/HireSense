// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InterviewPage from './InterviewPage'
import { fetchJob } from '../api/jobs'
import { getResumeAnalysis } from '../utils/resumeStorage'
import { getInterviewHistory, getInterviewReport, getInterviewSession, startInterview, submitInterviewAnswer } from '../api/interview'
import type { Job } from '../types'

vi.mock('../api/jobs', () => ({ fetchJob: vi.fn() }))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: vi.fn() }))
vi.mock('../api/interview', async () => ({ ...(await vi.importActual('../api/interview')), startInterview: vi.fn(), submitInterviewAnswer: vi.fn(), getInterviewSession: vi.fn(), getInterviewHistory: vi.fn(), getInterviewReport: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const resume = { name: null, email: null, phone: null, skills: ['Python'], education: [], experience: [], projects: [], leadership: [], experience_entries: [], project_entries: [], leadership_entries: [] }
const job = { id: 1, title: 'Backend Engineer', company: 'Acme', location: 'Denton, TX' } as Job
const question = { session_id: 9, question_index: 1, total_questions: 3, question_id: 'q1', focus_area: 'Project ownership', prompt: 'What did you build?', tips: ['Use a specific example'], question_type: 'mixed' as const, source: 'ai' as const, is_follow_up: false, parent_question_id: null, mode: 'mixed' as const }
const feedback = { score: 82, benchmark: 'Strong answer', summary: 'You gave concrete evidence.', strengths: ['Clear ownership'], improvements: ['Quantify the impact'], dimensions: [{ label: 'Specificity', score: 20, max_score: 25 }], source: 'ai' as const, suggested_approach: 'Add a measured result.', example_stronger_framing: 'I reduced latency by 20%.' }
const report = { session_id: 9, job_id: 1, job_title: 'Backend Engineer', company: 'Acme', completed_at: '2026-10-19T12:00:00', mode: 'mixed' as const, difficulty: 'realistic' as const, final_result: { final_score: 82, overall_band: 'Strong', overall_summary: 'Clear examples throughout.', top_strengths: ['Ownership'], next_steps: ['Add metrics'], practice_questions: ['What changed?'], skill_gaps_exposed: ['SQL'], personalized_action_plan: ['Practice tradeoffs'], source: 'ai' as const }, turns: [{ question_index: 1, question: 'What did you build?', answer: 'I built a parser.', feedback, is_follow_up: false }] }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchJob).mockResolvedValue(job)
  vi.mocked(getResumeAnalysis).mockReturnValue({ parsed_data: resume } as unknown as ReturnType<typeof getResumeAnalysis>)
  vi.mocked(startInterview).mockResolvedValue(question)
  vi.mocked(getInterviewReport).mockResolvedValue(report)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

async function render(path: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/interviews" element={<InterviewPage />} />
    <Route path="/interviews/new/:jobId" element={<InterviewPage />} />
    <Route path="/interviews/:sessionId" element={<InterviewPage />} />
  </Routes></MemoryRouter>))
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  expect(button).toBeDefined()
  await act(async () => button?.click())
}
async function typeAnswer(value: string) {
  const field = container.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('immersive interview experience', () => {
  it('launches from preflight into a focused question, evaluates, shows feedback and follow-up', async () => {
    await render('/interviews/new/1?mode=technical&difficulty=challenging&focus=technical_depth')
    expect(container.textContent).toContain('Step into your next interview')
    expect((container.querySelector('input[value="technical"]') as HTMLInputElement).checked).toBe(true)
    await click('Begin interview')
    expect(startInterview).toHaveBeenCalledWith(1, resume, { mode: 'technical', difficulty: 'challenging', question_count: 5, focus: ['technical_depth'] })
    expect(container.textContent).toContain('What did you build?')
    expect(container.textContent).not.toContain('Step into your next interview')
    let resolve!: (value: Awaited<ReturnType<typeof submitInterviewAnswer>>) => void
    vi.mocked(submitInterviewAnswer).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await typeAnswer('I built a parser.')
    await click('Submit answer')
    expect(container.textContent).toContain('Analyzing your answer')
    await act(async () => resolve({ session_id: 9, question_index: 1, is_complete: false, feedback, next_question: { ...question, question_id: 'follow', question_index: 2, is_follow_up: true, prompt: 'What changed?' }, final_result: null }))
    expect(container.textContent).toContain('What worked')
    expect(container.textContent).toContain('20/25')
    await click('Continue to next question')
    expect(container.textContent).toContain('Follow-up · building on your answer')
    expect(container.textContent).toContain('What changed?')
  })

  it('shows fallback coaching and preserves the draft on submission failure', async () => {
    await render('/interviews/new/1')
    await click('Begin interview')
    await typeAnswer('My specific example')
    vi.mocked(submitInterviewAnswer).mockRejectedValueOnce(new Error('Connection lost'))
    await click('Submit answer')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection lost')
    expect(container.querySelector('textarea')?.value).toBe('My specific example')
    vi.mocked(submitInterviewAnswer).mockResolvedValueOnce({ session_id: 9, question_index: 1, is_complete: false, feedback: { ...feedback, source: 'fallback' }, next_question: { ...question, question_index: 2 }, final_result: null })
    await click('Submit answer')
    expect(container.textContent).toContain('Standard coaching')
  })

  it('opens a completed debrief with expandable transcript and practice actions', async () => {
    vi.mocked(getInterviewSession).mockResolvedValue({ session_id: 9, job_id: 1, status: 'completed', mode: 'mixed', total_questions: 3, current_question: null, last_response: { session_id: 9, question_index: 3, is_complete: true, feedback, next_question: null, final_result: report.final_result } })
    await render('/interviews/9')
    expect(container.textContent).toContain('Interview debrief')
    expect(container.textContent).toContain('Question-by-question review')
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(container.textContent).toContain('Practice weak areas')
    expect(container.querySelector('a[href="/interviews/new/1?focus=weak_skill_areas"]')).not.toBeNull()
  })

  it('shows history, including score and a route back to the debrief', async () => {
    vi.mocked(getInterviewHistory).mockResolvedValue([{ session_id: 9, job_id: 1, job_title: 'Backend Engineer', company: 'Acme', completed_at: '2026-10-19T12:00:00', mode: 'mixed', difficulty: 'realistic', overall_band: 'Strong', final_score: 82, major_strengths: ['Ownership'], improvement_areas: ['Add metrics'], source: 'ai' }])
    await render('/interviews')
    expect(container.textContent).toContain('Interview history')
    expect(container.textContent).toContain('82/100')
    expect(container.querySelector('a[href="/interviews/9"]')).not.toBeNull()
  })

  it('moves from final answer review into a full debrief', async () => {
    await render('/interviews/new/1')
    await click('Begin interview')
    await typeAnswer('I built a parser.')
    vi.mocked(submitInterviewAnswer).mockResolvedValueOnce({ session_id: 9, question_index: 3, is_complete: true, feedback, next_question: null, final_result: report.final_result })
    await click('Submit answer')
    expect(container.textContent).toContain('View full debrief')
    await click('View full debrief')
    expect(container.textContent).toContain('Interview debrief')
    expect(container.textContent).toContain('Your next practice session')
  })

  it('recovers an interrupted question and hides hint text until requested', async () => {
    vi.mocked(getInterviewSession).mockResolvedValue({ session_id: 9, job_id: 1, status: 'in_progress', mode: 'mixed', total_questions: 3, current_question: question, last_response: null })
    await render('/interviews/9')
    expect(container.textContent).toContain('What did you build?')
    const hint = container.querySelector('details')!
    expect(hint.open).toBe(false)
    expect(hint.textContent).toContain('Use a specific example')
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('explains the missing resume without a broken preflight layout', async () => {
    vi.mocked(getResumeAnalysis).mockReturnValue(null)
    await render('/interviews/new/1')
    expect(container.textContent).toContain('Upload a resume')
    expect([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Begin interview'))?.disabled).toBe(true)
  })

  it('supports keyboard submission without exposing hints by default', async () => {
    await render('/interviews/new/1')
    await click('Begin interview')
    expect(container.querySelector('details')?.open).toBe(false)
    await typeAnswer('A clear result')
    vi.mocked(submitInterviewAnswer).mockResolvedValueOnce({ session_id: 9, question_index: 1, is_complete: false, feedback, next_question: { ...question, question_index: 2 }, final_result: null })
    await act(async () => container.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(submitInterviewAnswer).toHaveBeenCalledWith(9, 'A clear result', 'q1')
  })

  it('offers a retry when history cannot load', async () => {
    vi.mocked(getInterviewHistory).mockRejectedValueOnce(new Error('History unavailable')).mockResolvedValueOnce([])
    await render('/interviews')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('History unavailable')
    await click('Retry')
    expect(container.textContent).toContain('Your practice story starts here')
  })
})
