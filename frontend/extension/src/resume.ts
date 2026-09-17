import { serializeResume } from '../../src/features/autofill/resume/contract'

const picker = document.querySelector<HTMLInputElement>('#resume-file')!
const save = document.querySelector<HTMLButtonElement>('#save-resume')!
const clear = document.querySelector<HTMLButtonElement>('#clear-resume')!
const status = document.querySelector<HTMLElement>('#resume-status')!
const selected = document.querySelector<HTMLElement>('#selected-file')!

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: 'get-resume' })
  status.textContent = response?.resume
    ? 'Active resume: ' + response.resume.name + '. Available until ' + new Date(response.resume.expiresAt).toLocaleTimeString() + '.'
    : 'No active resume. Choose a file to reuse during this browser session.'
}
picker.addEventListener('change', () => {
  selected.textContent = picker.files?.[0]?.name ?? 'No file chosen'
  save.disabled = !picker.files?.length
})
save.addEventListener('click', async () => {
  const file = picker.files?.[0]
  if (!file) return
  save.disabled = true
  picker.disabled = true
  clear.disabled = true
  try {
    const payload = await serializeResume(file)
    const response = await chrome.runtime.sendMessage({ type: 'set-active-resume', file: payload })
    if (!response?.ok) throw new Error(response?.error || 'Could not save the resume for this session.')
    picker.value = ''
    selected.textContent = 'Ready to reuse'
    await refresh()
    status.textContent += ' Return to the application tab and reopen HireSense Autofill to preview. No file has been sent to an employer.'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not read this file.'
    save.disabled = false
  } finally { picker.disabled = false; clear.disabled = false }
})
clear.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'clear-resume' })
    if (!response?.ok) throw new Error('Could not clear the active resume.')
    picker.value = ''
    save.disabled = true
    selected.textContent = 'No file chosen'
    await refresh()
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not clear the resume.' }
})
void refresh().catch(() => { status.textContent = 'Could not connect. Reload this extension page.' })
