import { afterEach, describe, expect, it, vi } from 'vitest'
import { getInterviewSession, startInterview, submitInterviewAnswer } from './interview'
const auth = vi.hoisted(() => ({ token: 'account-token' as string | null }))
vi.mock('./auth', () => ({ getAuthSession: () => auth.token ? ({ token: auth.token, user: { id: 1 } }) : null }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); auth.token = 'account-token' })
const q = { session_id: 9, question_index: 1, total_questions: 3, question_id: 'q1', prompt: 'Describe your project.', focus_area: 'Project', tips: [] }
const answer = { session_id: 9, question_index: 1, is_complete: false, feedback: { score: 50, benchmark: 'Developing', summary: 'Add evidence.', strengths: [], improvements: [] }, next_question: { ...q, question_index: 2, question_id: 'q2' }, final_result: null }

describe('interview API', () => {
  it('sends safe resume evidence, mode, count, current question and authentication', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => q }).mockResolvedValueOnce({ ok: true, json: async () => answer })
    vi.stubGlobal('fetch', fetcher)
    await startInterview(7, { name: 'Private Person', email: 'private@example.com', phone: '5551234567', skills: ['Python'], education: [], experience_entries: [], project_entries: [], leadership_entries: [] } as never, { mode: 'technical', question_count: 3 })
    const payload = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(payload).toMatchObject({ job_id: 7, mode: 'technical', question_count: 3 })
    expect(payload.resume_data).not.toHaveProperty('name')
    expect(payload.resume_data).not.toHaveProperty('email')
    expect(payload.resume_data).not.toHaveProperty('phone')
    await submitInterviewAnswer(9, 'My answer', 'q1')
    expect(fetcher.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer account-token' })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ answer: 'My answer', question_id: 'q1' })
  })
  it('turns structured validation errors into readable messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'invalid' }] }) }))
    await expect(submitInterviewAnswer(9, 'answer', 'q2')).rejects.toThrow('Check your interview input')
  })
  it('times out requests with an actionable retry message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const pending = expect(submitInterviewAnswer(9, 'answer', 'q2')).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(45000)
    await pending
  })
  it('rejects malformed success responses so drafts remain retryable', async () => {
    for (const response of [{}, { ...answer, is_complete: true, final_result: null }, { ...answer, feedback: { ...answer.feedback, strengths: {} } }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))
      await expect(submitInterviewAnswer(9, 'answer', 'q2')).rejects.toThrow('incomplete')
    }
  })
  it('requires authentication before issuing network requests', async () => {
    auth.token = null
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(submitInterviewAnswer(9, 'answer', 'q2')).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('loads safe owned state with a GET request', async () => {
    const state = { session_id: 9, job_id: 7, status: 'in_progress', mode: 'mixed', total_questions: 3, current_question: q, last_response: null }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => state })
    vi.stubGlobal('fetch', fetcher)
    expect(await getInterviewSession(9)).toEqual(state)
    expect(fetcher.mock.calls[0][1].method).toBe('GET')
    expect(fetcher.mock.calls[0][1].body).toBeUndefined()
  })
})
