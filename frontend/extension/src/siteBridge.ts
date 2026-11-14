import {
  allowedSender,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_READY_CHANNEL,
  BRIDGE_REQUEST_CHANNEL,
  BRIDGE_RESPONSE_CHANNEL,
  isBridgeOperation,
  RUNTIME_BRIDGE_MESSAGES,
} from '../../src/features/autofill/bridgeContract'

// Runs only on the two manifest-listed HireSense origins, in Chrome's isolated world.
if (allowedSender(location.href)) {
  const bridgeWindow = window as typeof window & { __hireSenseSiteBridgeListener?: (event: MessageEvent) => void }
  if (bridgeWindow.__hireSenseSiteBridgeListener) {
    window.removeEventListener('message', bridgeWindow.__hireSenseSiteBridgeListener)
  }
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return
    const request = event.data
    const operation = request?.type
    if (request?.channel !== BRIDGE_REQUEST_CHANNEL ||
        typeof request.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(request.requestId) ||
        !isBridgeOperation(operation)) return
    const respond = (response: unknown) => window.postMessage({
      channel: BRIDGE_RESPONSE_CHANNEL, requestId: request.requestId,
      protocolVersion: BRIDGE_PROTOCOL_VERSION, response,
    }, location.origin)
    if (request.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      respond({ ok: false, code: 'protocol_mismatch', error: 'HireSense Autofill needs an update. Update the extension and refresh this page.' })
      return
    }
    chrome.runtime.sendMessage({
      type: RUNTIME_BRIDGE_MESSAGES[operation],
      ...(operation === 'set-confirmed-profile' ? { profile: request.profile } : {}),
    }).then(respond).catch(() => respond({ ok: false, code: 'background_rejected', error: 'The extension background connection is unavailable. Reload it and try again.' }))
  }
  bridgeWindow.__hireSenseSiteBridgeListener = listener
  window.addEventListener('message', listener)
  document.documentElement.dataset.hiresenseExtensionBridge = String(BRIDGE_PROTOCOL_VERSION)
  window.postMessage({ channel: BRIDGE_READY_CHANNEL, protocolVersion: BRIDGE_PROTOCOL_VERSION }, location.origin)
}
