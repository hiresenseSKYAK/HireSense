import { allowedSender, BRIDGE_PROTOCOL_VERSION } from '../../src/features/autofill/bridgeContract'

// Runs only on the two manifest-listed HireSense origins, in Chrome's isolated world.
if (allowedSender(location.href)) {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return
    const request = event.data
    if (request?.channel !== 'hiresense-extension-request' ||
        typeof request.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(request.requestId) ||
        !['ping', 'set-confirmed-profile', 'clear-profile'].includes(request.type)) return
    const respond = (response: unknown) => window.postMessage({
      channel: 'hiresense-extension-response', requestId: request.requestId,
      protocolVersion: BRIDGE_PROTOCOL_VERSION, response,
    }, location.origin)
    if (request.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      respond({ ok: false, error: 'HireSense Autofill needs an update. Reload the extension and this page.' })
      return
    }
    chrome.runtime.sendMessage({
      type: request.type === 'ping' ? 'site-bridge-ping'
        : request.type === 'clear-profile' ? 'site-bridge-clear' : 'site-bridge-profile',
      ...(request.type === 'set-confirmed-profile' ? { profile: request.profile } : {}),
    }).then(respond).catch(() => respond({ ok: false, error: 'The extension is unavailable. Reload it and try again.' }))
  })
}
