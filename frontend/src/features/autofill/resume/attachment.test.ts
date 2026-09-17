// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeApplicantProfile } from '../core/profile'
import { matchApplicationFields } from '../matcher/semanticMatcher'
import { executeAutofill } from '../matcher/fillExecutor'
import { attachResume, acceptsResume } from './attachment'
import { serializeResume, validResume, MAX_RESUME_BYTES } from './contract'

const profile = initializeApplicantProfile(null)
beforeEach(() => {
  const BrowserFile = File
  vi.stubGlobal('File', class extends BrowserFile {
    arrayBuffer(): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  })
  // jsdom lacks DataTransfer. Only this browser boundary is replaced.
  vi.stubGlobal('DataTransfer', class {
    files: File[] = []
    items = { add: (file: File) => this.files.push(file) }
  })
})
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function setup() {
  document.body.innerHTML = '<form><label>Resume / CV<input type="file" accept=".pdf,.docx"></label><button type="submit">Submit</button><button type="button">Next</button></form>'
  const input = document.querySelector('input')!
  let files: File[] = []
  Object.defineProperty(input, 'files', { configurable: true, get: () => files, set: (next) => { files = next } })
  return { input, preview: matchApplicationFields(document.body, profile)[0] }
}
const payload = () => serializeResume(new File(['%PDF-test-resume'], 'resume.pdf', { type: 'application/pdf', lastModified: 100 }))

describe('session resume contract', () => {
  it('serializes a user-selected real file and validates its actual byte count', async () => {
    const file = await payload()
    expect(validResume(file)).toBe(true)
    expect(atob(file.base64)).toBe('%PDF-test-resume')
    expect(validResume({ ...file, size: 1 })).toBe(false)
  })
  it('rejects oversized, unsupported and malformed file payloads', async () => {
    await expect(serializeResume(new File(['x'], 'resume.exe'))).rejects.toThrow()
    await expect(serializeResume(new File([new Uint8Array(MAX_RESUME_BYTES + 1)], 'big.pdf'))).rejects.toThrow()
    expect(validResume(null)).toBe(false)
    expect(validResume({ name: 'fake.pdf', base64: '$$$' })).toBe(false)
    expect(validResume({ ...(await payload()), name: '../resume.pdf' })).toBe(false)
  })
})

describe('explicit resume attachment', () => {
  it('does not attach anything during ordinary autofill', () => {
    const { input, preview } = setup()
    expect(executeAutofill(document.body, profile, [preview]).filled).toBe(0)
    expect(input.files?.length).toBe(0)
  })
  it('attaches the actual selected bytes, dispatches change, verifies retention and never submits', async () => {
    const { input, preview } = setup()
    const changed = vi.fn()
    input.addEventListener('change', changed)
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit')
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit')
    const clicks = vi.spyOn(HTMLElement.prototype, 'click')
    const result = await attachResume(document.body, profile, preview, await payload())
    expect(result.attached).toBe(true)
    expect(new TextDecoder().decode(await input.files![0].arrayBuffer())).toBe('%PDF-test-resume')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    expect(requestSubmit).not.toHaveBeenCalled()
    expect(clicks).not.toHaveBeenCalled()
  })
  it('preserves an existing file and rejects changes since preview', async () => {
    const { input, preview } = setup()
    Object.defineProperty(input, 'files', { value: [new File(['other'], 'other.pdf')] })
    expect((await attachResume(document.body, profile, preview, await payload())).attached).toBe(false)
    expect(input.files![0].name).toBe('other.pdf')
  })
  it('rejects changed accept rules, disconnected inputs and incompatible types', async () => {
    const { input, preview } = setup()
    input.accept = '.docx'
    expect(acceptsResume(input, await payload())).toBe(false)
    expect((await attachResume(document.body, profile, preview, await payload())).attached).toBe(false)
    input.remove()
    expect((await attachResume(document.body, profile, preview, await payload())).attached).toBe(false)
  })
  it('does not claim successful attachment when the site clears the input', async () => {
    const { input, preview } = setup()
    input.addEventListener('change', () => { Object.defineProperty(input, 'files', { value: [] }) })
    const result = await attachResume(document.body, profile, preview, await payload())
    expect(result.attached).toBe(false)
    expect(result.message).toContain('may already have uploaded')
  })
  it('provides a manual fallback when the browser cannot construct a FileList', async () => {
    const { preview } = setup()
    vi.stubGlobal('DataTransfer', undefined)
    expect((await attachResume(document.body, profile, preview, await payload())).attached).toBe(false)
  })
})
