// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { initializeApplicantProfile } from './core/profile'

const profile = { ...initializeApplicantProfile(null), fullName: 'Ada Lovelace' }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.resetModules() })

function replyToRequests(response: (request: Record<string, unknown>) => object) {
  return vi.spyOn(window, 'postMessage').mockImplementation((request: unknown) => {
    const data = request as Record<string, unknown>
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
      data: { channel: 'hiresense-extension-response', requestId: data.requestId,
        protocolVersion: 1, response: response(data) },
      origin: window.location.origin, source: window,
    })))
  })
}

it('detects the extension and sends only validated profile values', async () => {
  const post = replyToRequests((request) => request.type === 'ping'
    ? { ok: true, version: '0.4.0' } : { ok: true, fingerprint: 'abc', syncedAt: 123 })
  const { detectAutofillExtension, sendConfirmedProfileToExtension } = await import('./extensionBridge')
  expect(await detectAutofillExtension()).toEqual({ version: '0.4.0' })
  expect(await sendConfirmedProfileToExtension({ ...profile, authToken: 'private' } as typeof profile))
    .toEqual({ fingerprint: 'abc', syncedAt: 123 })
  expect(post.mock.calls[2][0]).toMatchObject({ type: 'set-confirmed-profile', profile })
  expect(JSON.stringify(post.mock.calls[2][0])).not.toContain('private')
})

it('explains missing extension and supports retry after installation', async () => {
  vi.useFakeTimers()
  const { detectAutofillExtension } = await import('./extensionBridge')
  const missing = expect(detectAutofillExtension()).rejects.toThrow('not detected')
  await vi.advanceTimersByTimeAsync(3000)
  await missing
  replyToRequests(() => ({ ok: true, version: '0.4.0' }))
  await expect(detectAutofillExtension()).resolves.toEqual({ version: '0.4.0' })
})

it('reports version mismatch and rejected profile storage', async () => {
  const post = replyToRequests((request) => request.type === 'ping'
    ? { ok: true, version: '0.4.0' } : { ok: false, error: 'Could not store the profile.' })
  const { sendConfirmedProfileToExtension } = await import('./extensionBridge')
  await expect(sendConfirmedProfileToExtension(profile)).rejects.toThrow('Could not store')
  post.mockRestore()
  vi.spyOn(window, 'postMessage').mockImplementation((request: unknown) => {
    const data = request as Record<string, unknown>
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
      data: { channel: 'hiresense-extension-response', requestId: data.requestId, protocolVersion: 999, response: { ok: true } },
      origin: window.location.origin, source: window,
    })))
  })
  await expect(sendConfirmedProfileToExtension(profile)).rejects.toThrow('outdated')
})

it('rejects spoofed response IDs and origins', async () => {
  vi.useFakeTimers()
  vi.spyOn(window, 'postMessage').mockImplementation((request: unknown) => {
    const data = request as Record<string, unknown>
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
      data: { channel: 'hiresense-extension-response', requestId: data.requestId, protocolVersion: 1, response: { ok: true } },
      origin: 'https://evil.example', source: window,
    })))
  })
  const { detectAutofillExtension } = await import('./extensionBridge')
  const rejected = expect(detectAutofillExtension()).rejects.toThrow('not detected')
  await vi.advanceTimersByTimeAsync(3000)
  await rejected
})

it('can clear a previously synced profile without transferring data', async () => {
  const post = replyToRequests(() => ({ ok: true }))
  const { clearSyncedProfile } = await import('./extensionBridge')
  await clearSyncedProfile()
  expect(post.mock.calls[0][0]).toMatchObject({ type: 'clear-profile' })
  expect(post.mock.calls[0][0]).not.toHaveProperty('profile')
})
