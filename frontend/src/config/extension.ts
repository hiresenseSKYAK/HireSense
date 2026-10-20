/** Public, build-time Chrome Web Store listing. Never treat it as a trusted arbitrary URL. */
export function getChromeExtensionStoreUrl(): string | null {
  const configured = import.meta.env.VITE_CHROME_EXTENSION_STORE_URL?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.hostname !== 'chromewebstore.google.com' ||
        !/^\/detail\/(?:[^/]+\/)?[a-p]{32}\/?$/.test(url.pathname) ||
        url.username || url.password || url.port) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}
