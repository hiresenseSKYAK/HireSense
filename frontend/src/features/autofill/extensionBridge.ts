import type { ApplicantProfile } from './core/types'
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_READY_CHANNEL,
  BRIDGE_REQUEST_CHANNEL,
  BRIDGE_RESPONSE_CHANNEL,
  fitProfileForExtension,
  transferableProfile,
  type BridgeErrorCode,
  type BridgeOperation,
} from './bridgeContract'

type BridgeResponse = { ok?: boolean; error?: string; code?: BridgeErrorCode; version?: string; fingerprint?: string; syncedAt?: number }

export class ExtensionBridgeError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string) {
    super(message)
    this.name = 'ExtensionBridgeError'
  }
}

export type ExtensionConnectionState = 'missing' | 'incompatible' | 'unresponsive'

export function extensionConnectionState(error: unknown): ExtensionConnectionState {
  if (!(error instanceof ExtensionBridgeError)) return 'unresponsive'
  if (error.code === 'protocol_mismatch') return 'incompatible'
  if (error.code === 'extension_not_installed' || error.code === 'content_script_missing') return 'missing'
  return 'unresponsive'
}

function diagnostic(code: BridgeErrorCode) {
  if (import.meta.env.DEV) console.info(`[HireSense extension bridge] ${code}`)
}

function bridgeError(code: BridgeErrorCode, message: string): ExtensionBridgeError {
  diagnostic(code)
  return new ExtensionBridgeError(code, message)
}

function requestExtension(type: BridgeOperation, profile?: ApplicantProfile): Promise<BridgeResponse> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      const bridgeWasInjected = document.documentElement.dataset.hiresenseExtensionBridge === String(BRIDGE_PROTOCOL_VERSION)
      const code: BridgeErrorCode = bridgeWasInjected ? 'bridge_timeout' : 'extension_not_installed'
      reject(bridgeError(code, type === 'ping'
        ? bridgeWasInjected
          ? 'HireSense Autofill is installed, but its background connection did not respond. Reload the extension, then retry.'
          : 'HireSense Autofill was not detected. Install or reload it, refresh this page, then retry.'
        : 'The extension stopped responding. Reload it, then retry sending your profile.'))
    }, 3000)
    function onMessage(event: MessageEvent) {
      const data = event.data
      if (event.source !== window || event.origin !== window.location.origin ||
          data?.channel !== BRIDGE_RESPONSE_CHANNEL || data.requestId !== requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        reject(bridgeError('protocol_mismatch', 'HireSense Autofill is outdated. Update or reinstall the extension, then refresh this page.'))
        return
      }
      resolve(data.response ?? { ok: false, error: 'The extension returned an invalid response.' })
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ channel: BRIDGE_REQUEST_CHANNEL, requestId, protocolVersion: BRIDGE_PROTOCOL_VERSION, type, ...(profile ? { profile } : {}) }, window.location.origin)
  })
}

function rejected(response: BridgeResponse, fallbackCode: BridgeErrorCode, fallback: string) {
  return bridgeError(response.code ?? fallbackCode, response.error || fallback)
}

export function onAutofillExtensionReady(callback: () => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin ||
        event.data?.channel !== BRIDGE_READY_CHANNEL) return
    if (event.data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      diagnostic('protocol_mismatch')
      return
    }
    callback()
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

export async function detectAutofillExtension(): Promise<{ version: string }> {
  const response = await requestExtension('ping')
  if (!response.ok || !response.version) throw rejected(response, 'background_rejected', 'HireSense Autofill is unavailable. Reload it and retry.')
  return { version: response.version }
}

export async function sendConfirmedProfileToExtension(profile: ApplicantProfile): Promise<{ fingerprint: string; syncedAt: number; limitedForOlderExtension?: true }> {
  const safeProfile = transferableProfile(profile)
  if (!safeProfile) throw bridgeError('profile_validation_failed', 'Review and confirm valid applicant details first.')
  const { version } = await detectAutofillExtension()
  const fitted = fitProfileForExtension(safeProfile, version)
  const response = await requestExtension('set-confirmed-profile', fitted.profile)
  if (!response.ok || !response.fingerprint || typeof response.syncedAt !== 'number') {
    throw rejected(response, 'storage_failed', 'The extension could not store your profile. Retry from Profile Review.')
  }
  return {
    fingerprint: response.fingerprint,
    syncedAt: response.syncedAt,
    ...(fitted.limited ? { limitedForOlderExtension: true as const } : {}),
  }
}

export async function clearSyncedProfile(): Promise<void> {
  const response = await requestExtension('clear-profile')
  if (!response.ok) throw rejected(response, 'background_rejected', 'Could not clear the extension profile.')
}
