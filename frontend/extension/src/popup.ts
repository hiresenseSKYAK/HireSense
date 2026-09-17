export {}
const status = document.querySelector<HTMLParagraphElement>('#status')!
const profileStatus = document.querySelector<HTMLElement>('#profile-status')!
const pageStatus = document.querySelector<HTMLElement>('#page-status')!
const previewButton = document.querySelector<HTMLButtonElement>('#preview')!
const fillButton = document.querySelector<HTMLButtonElement>('#fill')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear')!
const report = document.querySelector<HTMLElement>('#report')!
let approved: { previewId: string; tabId: number } | null = null

type Response = { ok?: boolean; error?: string; state?: string; supported?: boolean; summary?: string; ready?: number; previewId?: string; tabId?: number; fields?: Array<{ label: string; status: string; reason: string; value?: string; tone: string }> }

function renderReport(response: Response) {
  report.replaceChildren()
  for (const field of response.fields ?? []) {
    const row = document.createElement('div')
    row.className = 'field'
    const title = document.createElement('strong')
    title.textContent = field.label
    const badge = document.createElement('span')
    badge.className = 'badge ' + field.tone
    badge.textContent = field.status
    const reason = document.createElement('p')
    reason.textContent = field.reason
    row.append(title, badge)
    if (field.value) {
      const value = document.createElement('p')
      value.className = 'value'
      value.textContent = field.value
      row.append(value)
    }
    row.append(reason)
    report.append(row)
  }
}

async function send(message: object): Promise<Response> {
  const response = await chrome.runtime.sendMessage(message) as Response | undefined
  if (!response?.ok) throw new Error(response?.error || 'Extension unavailable. Reopen it and try again.')
  return response
}

async function refresh() {
  try {
    const response = await send({ type: 'get-profile' })
    profileStatus.textContent = response.state === 'ready' ? 'Ready · up to 30 min' : response.state === 'expired' ? 'Expired — resend from HireSense' : 'Not received'
    pageStatus.textContent = response.supported ? 'Ready to inspect' : 'Unsupported / unavailable'
    previewButton.disabled = response.state !== 'ready' || !response.supported
    clearButton.disabled = response.state !== 'ready'
    status.textContent = response.state === 'ready'
      ? 'Preview this application before filling. Existing answers stay yours.'
      : 'In HireSense, review and confirm your details, then choose Send to extension.'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not connect.'
  }
}

previewButton.addEventListener('click', async () => {
  previewButton.disabled = true
  clearButton.disabled = true
  fillButton.disabled = true
  fillButton.hidden = true
  approved = null
  report.replaceChildren()
  status.textContent = 'Inspecting the current page…'
  try {
    const response = await send({ type: 'preview-active-tab' })
    approved = { previewId: response.previewId!, tabId: response.tabId! }
    status.textContent = response.fields?.length ? response.summary! : 'No conventional application fields found. Custom widgets and embedded frames may need manual entry.'
    renderReport(response)
    fillButton.hidden = false
    fillButton.disabled = !response.ready
    fillButton.textContent = 'Fill ' + (response.ready ?? 0) + (response.ready === 1 ? ' supported field' : ' supported fields')
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not inspect this page.'
  } finally { previewButton.disabled = false; clearButton.disabled = false; previewButton.textContent = 'Preview again'; previewButton.classList.add('secondary') }
})

fillButton.addEventListener('click', async () => {
  if (!approved) return
  const request = approved
  approved = null
  fillButton.disabled = true
  previewButton.disabled = true
  clearButton.disabled = true
  status.textContent = 'Filling and verifying your details…'
  try {
    const response = await send({ type: 'fill-active-tab', ...request })
    status.textContent = response.summary! + '. Review every answer before you submit.'
    renderReport(response)
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not prepare this page.'
  } finally { fillButton.hidden = true; previewButton.disabled = false; clearButton.disabled = false }
})

clearButton.addEventListener('click', async () => {
  clearButton.disabled = true
  previewButton.disabled = true
  fillButton.disabled = true
  try {
    await send({ type: 'clear-profile' })
    approved = null
    report.replaceChildren()
    fillButton.hidden = true
    profileStatus.textContent = 'Not received'
    status.textContent = 'Profile cleared. Answers already filled on a page remain for you to review.'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not clear the profile.'
    clearButton.disabled = false
  }
})
void refresh()
