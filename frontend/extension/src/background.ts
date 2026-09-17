type ProfileMessage = { type: 'set-confirmed-profile'; profile: Record<string, string> }

const profileKey = 'confirmedApplicantProfile'

function isProfileMessage(message: unknown): message is ProfileMessage {
  if (!message || typeof message !== 'object' || (message as { type?: string }).type !== 'set-confirmed-profile') {
    return false
  }
  const profile = (message as ProfileMessage).profile
  return Boolean(profile && Object.values(profile).every((value) => typeof value === 'string'))
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!isProfileMessage(message)) {
    sendResponse({ ok: false, error: 'Only a confirmed applicant profile can be accepted.' })
    return
  }
  chrome.storage.session.set({ [profileKey]: message.profile }, () => sendResponse({ ok: true }))
  return true
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-profile') {
    chrome.storage.session.get(profileKey, (data) => sendResponse({ profile: data[profileKey] ?? null }))
    return true
  }
  if (message?.type === 'clear-profile') {
    chrome.storage.session.remove(profileKey, () => sendResponse({ ok: true }))
    return true
  }
  if (message?.type === 'fill-active-tab') {
    chrome.storage.session.get(profileKey, ({ confirmedApplicantProfile }) => {
      if (!confirmedApplicantProfile) {
        sendResponse({ ok: false, error: 'No confirmed HireSense profile is available.' })
        return
      }
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab.id) {
          sendResponse({ ok: false, error: 'No active tab is available.' })
          return
        }
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message })
            return
          }
          chrome.tabs.sendMessage(tab.id!, { type: 'fill-supported-fields', profile: confirmedApplicantProfile }, (result) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message })
              return
            }
            sendResponse({ ok: true, result })
          })
        })
      })
    })
    return true
  }
})
