// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

function popupMarkup() {
  document.body.innerHTML = `
    <p id="status"></p><strong id="profile-status"></strong><strong id="page-status"></strong>
    <button id="preview"></button><button id="fill"></button><button id="clear"></button>
    <button id="open-profile"></button><button id="choose-resume"></button><button id="attach-resume"></button>
    <p id="active-resume"></p><p id="attachment-status"></p><p id="attachment-warning"></p><div id="report"></div>`
}

it('updates an open popup to Profile ready when website sync storage changes', async () => {
  popupMarkup()
  let response: Record<string, unknown> = { ok: true, state: 'missing', supported: true, host: 'example.com', resume: null }
  type StorageListener = (changes: Record<string, unknown>, area: string) => void
  let storageListener: StorageListener | undefined
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: vi.fn(async () => response) },
    tabs: { create: vi.fn(async () => undefined) },
    storage: { onChanged: { addListener: (listener: StorageListener) => { storageListener = listener } } },
  })
  await import('../../../extension/src/popup')
  await vi.waitFor(() => expect(document.querySelector('#profile-status')?.textContent).toBe('Not synced'))

  const syncedAt = Date.now()
  response = { ok: true, state: 'ready', supported: true, host: 'example.com', syncedAt, resume: null }
  storageListener?.({ confirmedApplicantProfile: {} }, 'local')
  await vi.waitFor(() => expect(document.querySelector('#profile-status')?.textContent).toContain('Profile ready · synced'))
  expect(document.querySelector('#profile-status')?.textContent).toContain(new Date(syncedAt).toLocaleString())
})
