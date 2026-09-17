// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeApplicantProfile } from './core/profile'

// Chrome APIs are mocked at the boundary; real background/content listeners execute.
type Listener = (message: any, sender: any, respond: (value: any) => void) => unknown
let internal: Listener
let external: Listener
const profile = { ...initializeApplicantProfile(null), fullName: 'Ada Lovelace', email: 'ada@example.com' }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); delete (window as any).__hireSenseAutofillListener })
async function setupBackground() {
  vi.resetModules()
  const store: Record<string, any> = {}
  const api = {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => 'chrome-extension://test-extension/' + path,
      onMessageExternal: { addListener: (listener: Listener) => { external = listener } },
      onMessage: { addListener: (listener: Listener) => { internal = listener } },
    },
    storage: { session: {
      get: vi.fn(async () => store),
      set: vi.fn(async (values) => { Object.assign(store, values) }),
      remove: vi.fn(async (key) => { for (const name of Array.isArray(key) ? key : [key]) delete store[name] }),
    } },
    tabs: { query: vi.fn(async () => [{ id: 7, url: 'https://example.com/apply' }]), sendMessage: vi.fn(async (_tabId: number, _message: any) => ({ ok: true, previewId: 'preview' })) },
    scripting: { executeScript: vi.fn(async () => []) },
  }
  vi.stubGlobal('chrome', api)
  await import('../../../extension/src/background')
  const call = (message: unknown) => new Promise<any>((resolve) => internal(message, { url: api.runtime.getURL('popup.html') }, resolve))
  const resumeCall = (message: unknown) => new Promise<any>((resolve) => internal(message, { url: api.runtime.getURL('resume.html') }, resolve))
  const transfer = (url = 'https://hiresense-9yub.onrender.com/application/prepare') => new Promise<any>((resolve) => external({ type: 'set-confirmed-profile', profile: { ...profile, token: 'secret' } }, { url }, resolve))
  return { api, store, call, transfer, resumeCall }
}

describe('extension background handoff and permissions', () => {
  it('acknowledges only successful storage and returns state without PII to popup', async () => {
    const { transfer, call, store } = await setupBackground()
    expect(await transfer()).toEqual({ ok: true })
    expect(store.confirmedApplicantProfile.profile).toEqual(profile)
    const response = await call({ type: 'get-profile' })
    expect(response.state).toBe('ready')
    expect(response.profile).toBeUndefined()
    expect(JSON.stringify(response)).not.toContain('ada@example.com')
  })
  it('rejects a foreign origin without storing anything', async () => {
    const { transfer, store } = await setupBackground()
    expect((await transfer('https://evil.example')).ok).toBe(false)
    expect(store).toEqual({})
  })
  it('reports storage failures to the website', async () => {
    const { api, transfer } = await setupBackground()
    api.storage.session.set.mockRejectedValueOnce(new Error('storage unavailable'))
    expect((await transfer()).ok).toBe(false)
  })
  it('expires and clears profiles before a page can receive them', async () => {
    const { transfer, call, store, api } = await setupBackground()
    await transfer()
    store.confirmedApplicantProfile.expiresAt = Date.now() - 1
    expect((await call({ type: 'fill-active-tab', tabId: 7 })).ok).toBe(false)
    expect(store.confirmedApplicantProfile).toBeUndefined()
    expect(api.tabs.sendMessage).not.toHaveBeenCalled()
  })
  it('clears the profile and refuses to fill afterward', async () => {
    const { transfer, call, api } = await setupBackground()
    await transfer()
    expect((await call({ type: 'clear-profile' })).ok).toBe(true)
    expect((await call({ type: 'preview-active-tab' })).ok).toBe(false)
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
  })
  it('keeps resume bytes session-only and sends them only for an explicit attachment', async () => {
    const { transfer, call, resumeCall, store, api } = await setupBackground()
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 4, lastModified: 1, base64: btoa('demo') }
    await transfer()
    expect((await resumeCall({ type: 'set-active-resume', file })).ok).toBe(true)
    const state = await call({ type: 'get-profile' })
    expect(state.resume.name).toBe('resume.pdf')
    expect(JSON.stringify(state)).not.toContain(file.base64)
    await call({ type: 'preview-active-tab' })
    expect(api.tabs.sendMessage.mock.calls[0][1]).not.toHaveProperty('resume')
    const token = store.activeResume.token
    expect((await call({ type: 'attach-active-resume', tabId: 7, resumeToken: 'wrong' })).ok).toBe(false)
    await call({ type: 'attach-active-resume', tabId: 7, resumeToken: token, previewId: 'preview' })
    expect(api.tabs.sendMessage.mock.calls[api.tabs.sendMessage.mock.calls.length - 1][1].resume).toEqual(file)
    await call({ type: 'clear-profile' })
    expect(store).toEqual({})
  })
  it('expires the resume and rejects unauthorized popup file replacements', async () => {
    const { call, resumeCall, store } = await setupBackground()
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 4, lastModified: 1, base64: btoa('demo') }
    expect((await call({ type: 'set-active-resume', file })).ok).toBe(false)
    await resumeCall({ type: 'set-active-resume', file })
    store.activeResume.expiresAt = 0
    expect((await resumeCall({ type: 'get-resume' })).resume).toBeNull()
    expect(store.activeResume).toBeUndefined()
  })
  it('rejects tab changes and restricted pages', async () => {
    const { transfer, call, api } = await setupBackground()
    await transfer()
    expect((await call({ type: 'fill-active-tab', tabId: 8 })).error).toContain('tab changed')
    api.tabs.query.mockResolvedValueOnce([{ id: 7, url: 'chrome://settings' }])
    expect((await call({ type: 'preview-active-tab' })).ok).toBe(false)
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
  })
})

describe('extension content preview handshake', () => {
  async function setupContent() {
    vi.resetModules()
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', onMessage: { addListener: (listener: Listener) => { internal = listener } } } })
    document.body.innerHTML = '<form><label>Email<input type="email" name="email"></label><button type="submit">Submit</button></form>'
    await import('../../../extension/src/content')
    return (message: object) => new Promise<any>((resolve) => internal({ profile, token: 'profile-1', expiresAt: Date.now() + 60000, ...message }, { id: 'test-extension' }, resolve))
  }
  it('requires preview, fills verified values once, and never submits', async () => {
    const call = await setupContent()
    expect((await call({ type: 'fill-supported-fields' })).ok).toBe(false)
    const preview = await call({ type: 'preview-supported-fields' })
    expect(preview.ready).toBe(1)
    expect(document.querySelector('input')!.value).toBe('')
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit')
    const result = await call({ type: 'fill-supported-fields', previewId: preview.previewId })
    expect(result.fields[0].status).toBe('Filled & verified')
    expect(document.querySelector('input')!.value).toBe(profile.email)
    expect(submit).not.toHaveBeenCalled()
    expect((await call({ type: 'fill-supported-fields', previewId: preview.previewId })).ok).toBe(false)
  })
  it('rejects changed profiles, stale previews, and expired data', async () => {
    const call = await setupContent()
    const preview = await call({ type: 'preview-supported-fields' })
    expect((await call({ type: 'fill-supported-fields', previewId: preview.previewId, token: 'new-profile' })).ok).toBe(false)
    expect((await call({ type: 'fill-supported-fields', previewId: 'wrong-preview' })).ok).toBe(false)
    expect((await call({ type: 'fill-supported-fields', previewId: preview.previewId, expiresAt: 0 })).ok).toBe(false)
    expect(document.querySelector('input')!.value).toBe('')
  })
})
