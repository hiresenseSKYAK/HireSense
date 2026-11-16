// @vitest-environment node
import { expect, it } from 'vitest'
import manifestText from '../../../extension/static/manifest.json?raw'
import siteBridgeSource from '../../../extension/src/siteBridge.ts?raw'
import backgroundSource from '../../../extension/src/background.ts?raw'
import packageText from '../../../package.json?raw'
import extensionBridgeSource from './extensionBridge.ts?raw'
import profileReviewSource from './ProfileReview.tsx?raw'
import prepareApplicationSource from './PrepareApplicationPage.tsx?raw'

it('packages the production origin and generated site bridge without an extension ID', () => {
  const manifest = JSON.parse(manifestText) as {
    version: string
    content_scripts: Array<{ matches: string[]; js: string[] }>
  }
  expect(manifest.version).toBe('0.4.2')
  expect(manifest.content_scripts[0].matches).toContain('https://hiresense-9yub.onrender.com/*')
  expect(manifest.content_scripts[0].js).toEqual(['siteBridge.js'])
  expect(packageText).toContain('extension/vite.site-bridge.config.ts')

  const runtimeSources = [
    extensionBridgeSource,
    siteBridgeSource,
    backgroundSource,
    profileReviewSource,
    prepareApplicationSource,
  ].join('\n')
  expect(runtimeSources).not.toContain('VITE_AUTOFILL_EXTENSION_ID')
  expect(runtimeSources).not.toMatch(/chrome-extension:\/\/[a-p]{32}/)
  expect(runtimeSources).not.toMatch(/chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?[a-p]{32}/)
})
