// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { initializeApplicantProfile } from './core/profile'
const profile = { ...initializeApplicantProfile(null), fullName: 'Ada Lovelace' }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })
async function bridge(runtime?: object) {
  vi.resetModules()
  vi.stubEnv('VITE_AUTOFILL_EXTENSION_ID', 'a'.repeat(32))
  vi.stubGlobal('chrome', runtime ? { runtime } : undefined)
  return import('./extensionBridge')
}
it('sends only approved profile values and waits for acknowledgment', async () => {
  const sendMessage = vi.fn((_id, _message, callback) => callback({ ok: true }))
  const { sendConfirmedProfileToExtension } = await bridge({ sendMessage })
  await sendConfirmedProfileToExtension({ ...profile, authToken: 'private' } as typeof profile)
  expect(sendMessage.mock.calls[0][0]).toBe('a'.repeat(32))
  expect(sendMessage.mock.calls[0][1]).toEqual({ type: 'set-confirmed-profile', profile })
})
it('shows a useful connection error without claiming success', async () => {
  const { sendConfirmedProfileToExtension } = await bridge({
    lastError: { message: 'Receiving end does not exist' },
    sendMessage: (_id: string, _message: unknown, callback: () => void) => callback(),
  })
  await expect(sendConfirmedProfileToExtension(profile)).rejects.toThrow('Check that the extension is enabled')
})
it('rejects missing extension support', async () => {
  const { canUseAutofillExtension, sendConfirmedProfileToExtension } = await bridge()
  expect(canUseAutofillExtension()).toBe(false)
  await expect(sendConfirmedProfileToExtension(profile)).rejects.toThrow('not configured')
})
it('does not leave the handoff loading forever', async () => {
  vi.useFakeTimers()
  const { sendConfirmedProfileToExtension } = await bridge({ sendMessage: vi.fn() })
  const assertion = expect(sendConfirmedProfileToExtension(profile)).rejects.toThrow('did not respond')
  await vi.advanceTimersByTimeAsync(10000)
  await assertion
})
