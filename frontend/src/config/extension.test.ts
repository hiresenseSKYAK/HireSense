import { afterEach, expect, it, vi } from 'vitest'
import { getChromeExtensionStoreUrl } from './extension'

afterEach(() => vi.unstubAllEnvs())

it('accepts an exact HTTPS Chrome Web Store listing', () => {
  const listing = `https://chromewebstore.google.com/detail/hiresense-autofill/${'a'.repeat(32)}`
  vi.stubEnv('VITE_CHROME_EXTENSION_STORE_URL', listing)
  expect(getChromeExtensionStoreUrl()).toBe(listing)
})

it('omits an absent or unsafe listing URL', () => {
  vi.stubEnv('VITE_CHROME_EXTENSION_STORE_URL', '')
  expect(getChromeExtensionStoreUrl()).toBeNull()
  for (const value of ['javascript:alert(1)', 'https://chromewebstore.google.com.evil.test/detail/a',
    'http://chromewebstore.google.com/detail/' + 'a'.repeat(32),
    'https://chromewebstore.google.com/detail/hiresense-autofill/NOT_APPROVED']) {
    vi.stubEnv('VITE_CHROME_EXTENSION_STORE_URL', value)
    expect(getChromeExtensionStoreUrl()).toBeNull()
  }
})
