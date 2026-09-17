import type { ApplicantProfile } from './core/types'

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          callback: (response?: { ok?: boolean; error?: string }) => void,
        ) => void
        lastError?: { message?: string }
      }
    }
  }
}

const extensionId = import.meta.env.VITE_AUTOFILL_EXTENSION_ID?.trim()

export function canUseAutofillExtension(): boolean {
  return Boolean(extensionId && window.chrome?.runtime)
}

export function sendConfirmedProfileToExtension(
  profile: ApplicantProfile,
): Promise<void> {
  if (!extensionId || !window.chrome?.runtime) {
    return Promise.reject(new Error('The HireSense browser bridge is not configured.'))
  }

  return new Promise((resolve, reject) => {
    window.chrome?.runtime?.sendMessage(
      extensionId,
      { type: 'set-confirmed-profile', profile },
      (response) => {
        if (window.chrome?.runtime?.lastError) {
          reject(new Error(window.chrome.runtime.lastError.message))
          return
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'The browser bridge did not accept this profile.'))
          return
        }
        resolve()
      },
    )
  })
}
