import { allowedSender, PROFILE_TTL_MS, profileExpired, transferableProfile } from '../../src/features/autofill/bridgeContract'
import { RESUME_TTL_MS, validResume, type SessionResume } from '../../src/features/autofill/resume/contract'

const profileKey = 'confirmedApplicantProfile'
const resumeKey = 'activeResume'
type StoredProfile = { profile: NonNullable<ReturnType<typeof transferableProfile>>; expiresAt: number; token: string }
type StoredResume = { file: SessionResume; expiresAt: number; token: string }

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

async function readResume(): Promise<StoredResume | undefined> {
  const data = await chrome.storage.session.get(resumeKey)
  const stored = data[resumeKey] as StoredResume | undefined
  if (stored && (profileExpired(stored.expiresAt) || !validResume(stored.file))) {
    await chrome.storage.session.remove(resumeKey)
    return undefined
  }
  return stored
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
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html')
  const fromResumePage = sender.url === chrome.runtime.getURL('resume.html')
  if (!fromPopup && !fromResumePage) return
  void (async () => {
    if (message?.type === 'set-active-resume' && fromResumePage) {
      if (!validResume(message.file)) throw new Error('Choose a PDF or DOCX resume up to 2 MB.')
      // Store only the explicitly defined file contract, not arbitrary message properties.
      const { name, size, type, lastModified, base64 } = message.file as SessionResume
      await chrome.storage.session.set({ [resumeKey]: {
        file: { name, size, type, lastModified, base64 }, expiresAt: Date.now() + RESUME_TTL_MS, token: crypto.randomUUID(),
      } })
      return { ok: true, name }
    }
    if (message?.type === 'clear-resume') {
      await chrome.storage.session.remove(resumeKey)
      return { ok: true }
    }
    if (message?.type === 'get-resume') {
      const resume = await readResume()
      return { ok: true, resume: resume ? { name: resume.file.name, size: resume.file.size, expiresAt: resume.expiresAt } : null }
    }
    if (!fromPopup) throw new Error('Use the extension popup to prepare an application.')
    if (message?.type === 'choose-resume') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('resume.html') })
      return { ok: true }
    }
    if (message?.type === 'clear-profile') {
      await chrome.storage.session.remove([profileKey, resumeKey])
      return { ok: true }
    }
    const { state, stored } = await readProfile()
    const resume = await readResume()
    const resumeInfo = resume ? { name: resume.file.name, size: resume.file.size, token: resume.token } : null
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const supported = Boolean(tab?.id && tab.url && /^https?:\/\//.test(tab.url))
    const host = supported ? new URL(tab!.url!).hostname : ''
    if (message?.type === 'get-profile') return { ok: true, state, supported, host, expiresAt: stored?.expiresAt, resume: resumeInfo }
    if (!['preview-active-tab', 'fill-active-tab', 'attach-active-resume'].includes(message?.type)) throw new Error('Unknown action.')
    if (!stored) throw new Error(state === 'expired' ? 'Profile expired. Send it again from HireSense.' : 'Send a confirmed profile from HireSense first.')
    if (!supported || !tab?.id) throw new Error('Open a regular application webpage. Browser settings and protected pages cannot be filled.')
    if (message.type !== 'preview-active-tab' && message.tabId !== tab.id) throw new Error('The active tab changed. Preview this page again.')
    if (message.type === 'attach-active-resume' && (!resume || resume.token !== message.resumeToken)) {
      throw new Error('The active resume changed or expired. Choose your resume and preview again.')
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: message.type === 'preview-active-tab' ? 'preview-supported-fields'
        : message.type === 'attach-active-resume' ? 'attach-resume' : 'fill-supported-fields',
      profile: stored.profile, token: stored.token, expiresAt: stored.expiresAt, previewId: message.previewId,
      ...(message.type === 'attach-active-resume' ? { resume: resume!.file, resumeExpiresAt: resume!.expiresAt } : {}),
    })
    return { ...result, tabId: tab.id, host, resume: resumeInfo }
  })().then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'This page is unavailable. Try reopening the application tab.' }))
  return true
})
