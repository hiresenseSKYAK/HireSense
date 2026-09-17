import { allowedSender, PROFILE_TTL_MS, profileExpired, transferableProfile } from '../../src/features/autofill/bridgeContract'

const profileKey = 'confirmedApplicantProfile'
type StoredProfile = { profile: NonNullable<ReturnType<typeof transferableProfile>>; expiresAt: number; token: string }

async function readProfile(): Promise<{ state: 'ready' | 'expired' | 'missing'; stored?: StoredProfile }> {
  const data = await chrome.storage.session.get(profileKey)
  const stored = data[profileKey] as StoredProfile | undefined
  if (!stored) return { state: 'missing' }
  if (profileExpired(stored.expiresAt) || !transferableProfile(stored.profile) || !stored.token) {
    await chrome.storage.session.remove(profileKey)
    return { state: 'expired' }
  }
  return { state: 'ready', stored }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const profile = message?.type === 'set-confirmed-profile' ? transferableProfile(message.profile) : null
  if (!allowedSender(sender.url) || !profile) {
    sendResponse({ ok: false, error: 'Only valid applicant details from HireSense can be accepted.' })
    return
  }
  chrome.storage.session.set({ [profileKey]: { profile, expiresAt: Date.now() + PROFILE_TTL_MS, token: crypto.randomUUID() } })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false, error: 'Could not store the profile. Please try again.' }))
  return true
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension popup may read state or ask the active tab to act.
  if (sender.url !== chrome.runtime.getURL('popup.html')) return
  void (async () => {
    if (message?.type === 'clear-profile') {
      await chrome.storage.session.remove(profileKey)
      return { ok: true }
    }
    const { state, stored } = await readProfile()
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const supported = Boolean(tab?.id && tab.url && /^https?:\/\//.test(tab.url))
    if (message?.type === 'get-profile') return { ok: true, state, supported, expiresAt: stored?.expiresAt }
    if (!['preview-active-tab', 'fill-active-tab'].includes(message?.type)) throw new Error('Unknown action.')
    if (!stored) throw new Error(state === 'expired' ? 'Profile expired. Send it again from HireSense.' : 'Send a confirmed profile from HireSense first.')
    if (!supported || !tab?.id) throw new Error('Open a regular application webpage. Browser settings and protected pages cannot be filled.')
    if (message.type === 'fill-active-tab' && message.tabId !== tab.id) throw new Error('The active tab changed. Preview this page again.')
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: message.type === 'preview-active-tab' ? 'preview-supported-fields' : 'fill-supported-fields',
      profile: stored.profile, token: stored.token, expiresAt: stored.expiresAt, previewId: message.previewId,
    })
    return { ...result, tabId: tab.id }
  })().then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'This page is unavailable. Try reopening the application tab.' }))
  return true
})
