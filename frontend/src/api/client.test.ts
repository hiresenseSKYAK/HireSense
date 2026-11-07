// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import client from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as Response
}

describe('API client request safety', () => {
  it('deduplicates identical concurrent GET requests', async () => {
    let resolveFetch!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetcher)

    const first = client.get<{ value: number }>('/dedupe-test')
    const second = client.get<{ value: number }>('/dedupe-test')
    expect(fetcher).toHaveBeenCalledTimes(1)
    resolveFetch(ok({ value: 7 }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { data: { value: 7 } },
      { data: { value: 7 } },
    ])
  })

  it('retries a transient GET once', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: 'busy' }) })
      .mockResolvedValueOnce(ok({ ready: true }))
    vi.stubGlobal('fetch', fetcher)

    await expect(client.get('/retry-test')).resolves.toEqual({ data: { ready: true } })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('never retries a mutation', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'busy' }) })
    vi.stubGlobal('fetch', fetcher)

    await expect(client.post('/mutation-test', { value: 1 })).rejects.toThrow('busy')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
