import type { ApplicantProfile } from './core/types'
import { transferableProfile } from './bridgeContract'

const extensionId = import.meta.env.VITE_AUTOFILL_EXTENSION_ID?.trim()

export function canUseAutofillExtension(): boolean {
  return Boolean(extensionId && window.chrome?.runtime?.sendMessage)
}

export function sendConfirmedProfileToExtension(
  profile: ApplicantProfile,
): Promise<void> {
  if (!extensionId || !window.chrome?.runtime) {
    return Promise.reject(new Error('The HireSense browser bridge is not configured.'))
  }

  const safeProfile = transferableProfile(profile)
  if (!safeProfile) return Promise.reject(new Error('Review and confirm valid applicant details first.'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The extension did not respond. Open HireSense Autofill in Chrome, then try again.')), 10000)
    window.chrome?.runtime?.sendMessage(
      extensionId,
      { type: 'set-confirmed-profile', profile: safeProfile },
      (response?: { ok?: boolean; error?: string }) => {
        clearTimeout(timeout)
        if (window.chrome?.runtime?.lastError) {
          reject(new Error('Could not connect to HireSense Autofill. Check that the extension is enabled, reload this page, and try again.'))
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
