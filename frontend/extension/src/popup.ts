export {}
const status = document.querySelector<HTMLParagraphElement>('#status')!
const profileStatus = document.querySelector<HTMLElement>('#profile-status')!
const pageStatus = document.querySelector<HTMLElement>('#page-status')!
const previewButton = document.querySelector<HTMLButtonElement>('#preview')!
const fillButton = document.querySelector<HTMLButtonElement>('#fill')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear')!
const chooseButton = document.querySelector<HTMLButtonElement>('#choose-resume')!
const attachButton = document.querySelector<HTMLButtonElement>('#attach-resume')!
const activeResume = document.querySelector<HTMLElement>('#active-resume')!
const attachmentStatus = document.querySelector<HTMLElement>('#attachment-status')!
const attachmentWarning = document.querySelector<HTMLElement>('#attachment-warning')!
const report = document.querySelector<HTMLElement>('#report')!
let approved: { previewId: string; tabId: number; resumeToken?: string } | null = null

type Response = {
  ok?: boolean; error?: string; state?: string; supported?: boolean; summary?: string; ready?: number;
  previewId?: string; tabId?: number; host?: string; attachmentReady?: boolean; resumeStatus?: string;
  resume?: { name: string; token: string }; attached?: boolean;
  fields?: Array<{ label: string; status: string; reason: string; value?: string; tone: string; section: string }>
}

function renderReport(response: Response) {
  report.replaceChildren()
  for (const [key, label] of [['ready', 'Ready to fill'], ['handled', 'HireSense handled / preserved'], ['manual', 'You still need to answer'], ['untouched', 'Left untouched']]) {
    const fields = response.fields?.filter((field) => field.section === key) ?? []
    if (!fields.length) continue
    const heading = document.createElement('h2')
    heading.textContent = label + ' · ' + fields.length
    report.append(heading)
    for (const field of fields) {
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
}

async function send(message: object): Promise<Response> {
  const response = await chrome.runtime.sendMessage(message) as Response | undefined
  if (!response?.ok) throw new Error(response?.error || 'Extension unavailable. Reopen it and try again.')
  return response
}
function resumeState(response: Response) {
  activeResume.textContent = response.resume?.name ? 'Active: ' + response.resume.name : 'No active resume — choose a PDF or DOCX once for this session.'
  if (response.resumeStatus) attachmentStatus.textContent = response.resumeStatus
}
function busy(value: boolean) {
  previewButton.disabled = value
  clearButton.disabled = value
  chooseButton.disabled = value
  fillButton.disabled = value
  attachButton.disabled = value
}

async function refresh() {
  try {
    const response = await send({ type: 'get-profile' })
    profileStatus.textContent = response.state === 'ready' ? 'Ready · up to 30 min' : response.state === 'expired' ? 'Expired — resend from HireSense' : 'Not received'
    pageStatus.textContent = response.supported ? response.host || 'Ready to inspect' : 'Unsupported / unavailable'
    previewButton.disabled = response.state !== 'ready' || !response.supported
    clearButton.disabled = response.state !== 'ready' && !response.resume
    resumeState(response)
    status.textContent = response.state === 'ready'
      ? 'Preview this application before filling. Existing answers stay yours.'
      : 'In HireSense, review and confirm your details, then choose Send to extension.'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not connect.'
  }
}

previewButton.addEventListener('click', async () => {
  busy(true)
  fillButton.hidden = true
  attachButton.hidden = true
  attachmentWarning.hidden = true
  approved = null
  report.replaceChildren()
  status.textContent = 'Inspecting the current page…'
  try {
    const response = await send({ type: 'preview-active-tab' })
    approved = { previewId: response.previewId!, tabId: response.tabId!, resumeToken: response.resume?.token }
    status.textContent = response.fields?.length ? response.summary! : 'No conventional application fields found. Custom widgets and embedded frames may need manual entry.'
    renderReport(response)
    resumeState(response)
    busy(false)
    fillButton.hidden = false
    fillButton.disabled = !response.ready
    fillButton.textContent = 'Fill ' + (response.ready ?? 0) + (response.ready === 1 ? ' supported field' : ' supported fields')
    attachButton.hidden = !response.attachmentReady || !response.resume
    attachButton.disabled = attachButton.hidden
    attachButton.textContent = 'Attach resume to ' + response.host
    attachmentWarning.hidden = attachButton.hidden
  } catch (error) {
    busy(false)
    fillButton.disabled = true
    attachButton.disabled = true
    status.textContent = error instanceof Error ? error.message : 'Could not inspect this page.'
  } finally {
    previewButton.textContent = 'Preview again'
    previewButton.classList.add('secondary')
  }
})

fillButton.addEventListener('click', async () => {
  if (!approved) return
  const canAttach = !attachButton.hidden && !attachButton.disabled
  busy(true)
  status.textContent = 'Filling and verifying your details…'
  try {
    const response = await send({ type: 'fill-active-tab', ...approved })
    status.textContent = 'Application preparation results: ' + response.summary! + '. Review every answer before you submit.'
    resumeState(response)
    renderReport(response)
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not prepare this page.'
  } finally { busy(false); fillButton.hidden = true; fillButton.disabled = true; attachButton.disabled = !canAttach }
})

attachButton.addEventListener('click', async () => {
  if (!approved || !approved.resumeToken) return
  const canFill = !fillButton.hidden && !fillButton.disabled
  busy(true)
  attachmentStatus.textContent = 'Handing your resume to this application…'
  try {
    const response = await send({ type: 'attach-active-resume', ...approved })
    resumeState(response)
    renderReport(response)
  } catch (error) {
    attachmentStatus.textContent = error instanceof Error ? error.message : 'Could not verify the attachment. Check the application before retrying.'
  } finally {
    busy(false)
    attachButton.hidden = true
    attachButton.disabled = true
    attachmentWarning.hidden = true
    fillButton.disabled = !canFill
  }
})

chooseButton.addEventListener('click', async () => {
  try { await send({ type: 'choose-resume' }) }
  catch { status.textContent = 'Could not open the resume chooser. Reopen the extension and try again.' }
})

clearButton.addEventListener('click', async () => {
  busy(true)
  try {
    await send({ type: 'clear-profile' })
    approved = null
    report.replaceChildren()
    fillButton.hidden = true
    attachButton.hidden = true
    attachmentWarning.hidden = true
    profileStatus.textContent = 'Not received'
    activeResume.textContent = 'No active resume'
    attachmentStatus.textContent = 'Session cleared. Files already sent to a site cannot be recalled here.'
    status.textContent = 'Profile and resume cleared. Existing application answers remain for you to review.'
    chooseButton.disabled = false
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not clear the session.'
    clearButton.disabled = false
  }
})
void refresh()
