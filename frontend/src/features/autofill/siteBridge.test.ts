// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://hiresense-9yub.onrender.com/application/prepare"}
import { afterEach, expect, it, vi } from 'vitest'
import { BRIDGE_REQUEST_CHANNEL, BRIDGE_RESPONSE_CHANNEL } from './bridgeContract'

const bridgeWindow = window as typeof window & { __hireSenseSiteBridgeListener?: (event: MessageEvent) => void }

afterEach(() => {
  if (bridgeWindow.__hireSenseSiteBridgeListener) {
    window.removeEventListener('message', bridgeWindow.__hireSenseSiteBridgeListener)
    delete bridgeWindow.__hireSenseSiteBridgeListener
  }
  delete document.documentElement.dataset.hiresenseExtensionBridge
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function requestPing(requestId: string) {
  return new Promise<Record<string, unknown>>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.channel !== BRIDGE_RESPONSE_CHANNEL || event.data.requestId !== requestId) return
      window.removeEventListener('message', listener)
      resolve(event.data)
    }
    window.addEventListener('message', listener)
    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: BRIDGE_REQUEST_CHANNEL, requestId, protocolVersion: 1, type: 'ping' },
      origin: location.origin,
      source: window,
    }))
  })
}

it('bridges the exact production origin to the extension runtime', async () => {
  const sendMessage = vi.fn(async () => ({ ok: true, version: '0.4.1' }))
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  await import('../../../extension/src/siteBridge')

  const response = await requestPing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  expect(sendMessage).toHaveBeenCalledWith({ type: 'site-bridge-ping' })
  expect(response).toMatchObject({ protocolVersion: 1, response: { ok: true, version: '0.4.1' } })
  expect(document.documentElement.dataset.hiresenseExtensionBridge).toBe('1')
})

it('replaces its listener cleanly after an extension reload', async () => {
  const sendMessage = vi.fn(async () => ({ ok: true, version: '0.4.1' }))
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  await import('../../../extension/src/siteBridge')
  vi.resetModules()
  await import('../../../extension/src/siteBridge')

  await requestPing('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  expect(sendMessage).toHaveBeenCalledTimes(1)
})
