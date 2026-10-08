import { afterEach, describe, expect, it, vi } from 'vitest'
import { startInterview, submitInterviewAnswer } from './interview'

vi.mock('./auth', () => ({ getAuthSession: () => ({ token: 'account-token' }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('interview API', () => {
  it('sends mode, count, current question and session capability', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetcher)
    await startInterview(7, { skills: ['Python'] } as never, { mode: 'technical', question_count: 3 })
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ job_id: 7, mode: 'technical', question_count: 3 })
    await submitInterviewAnswer(9, 'My answer', 'q2', 'guest-token')
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer account-token', 'X-Interview-Token': 'guest-token' })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ answer: 'My answer', question_id: 'q2' })
  })

  it('turns structured validation errors into readable messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: [{ msg: 'invalid' }] }) }))
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

})
