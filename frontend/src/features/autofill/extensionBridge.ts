import type { ApplicantProfile } from './core/types'
import { BRIDGE_PROTOCOL_VERSION, transferableProfile } from './bridgeContract'

type BridgeResponse = { ok?: boolean; error?: string; version?: string; fingerprint?: string; syncedAt?: number }

function requestExtension(type: 'ping' | 'set-confirmed-profile' | 'clear-profile', profile?: ApplicantProfile): Promise<BridgeResponse> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error(type === 'ping'
        ? 'HireSense Autofill was not detected. Install or reload the extension, refresh this page, then retry.'
        : 'The extension stopped responding. Reload it, then retry sending your profile.'))
    }, 3000)
    function onMessage(event: MessageEvent) {
      const data = event.data
      if (event.source !== window || event.origin !== window.location.origin ||
          data?.channel !== 'hiresense-extension-response' || data.requestId !== requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        reject(new Error('HireSense Autofill is outdated. Reload or reinstall the extension, then refresh this page.'))
        return
      }
      resolve(data.response ?? { ok: false, error: 'The extension returned an invalid response.' })
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ channel: 'hiresense-extension-request', requestId, protocolVersion: BRIDGE_PROTOCOL_VERSION, type, ...(profile ? { profile } : {}) }, window.location.origin)
  })
}

export async function detectAutofillExtension(): Promise<{ version: string }> {
  const response = await requestExtension('ping')
  if (!response.ok || !response.version) throw new Error(response.error || 'HireSense Autofill is unavailable. Reload it and retry.')
  return { version: response.version }
}

export async function sendConfirmedProfileToExtension(profile: ApplicantProfile): Promise<{ fingerprint: string; syncedAt: number }> {
  const safeProfile = transferableProfile(profile)
  if (!safeProfile) throw new Error('Review and confirm valid applicant details first.')
  await detectAutofillExtension()
  const response = await requestExtension('set-confirmed-profile', safeProfile)
  if (!response.ok || !response.fingerprint || typeof response.syncedAt !== 'number') {
    throw new Error(response.error || 'The extension could not store your profile. Retry from Profile Review.')
  }
  return { fingerprint: response.fingerprint, syncedAt: response.syncedAt }
}

export async function clearSyncedProfile(): Promise<void> {
  const response = await requestExtension('clear-profile')
  if (!response.ok) throw new Error(response.error || 'Could not clear the extension profile.')
}
