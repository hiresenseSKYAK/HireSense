const status = document.querySelector<HTMLParagraphElement>('#status')!
const fillButton = document.querySelector<HTMLButtonElement>('#fill')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear')!

function setStatus(message: string, canFill: boolean) {
  status.textContent = message
  fillButton.disabled = !canFill
}

chrome.runtime.sendMessage({ type: 'get-profile' }, (response) => {
  setStatus(
    response?.profile
      ? 'A confirmed profile is ready for this browser session.'
      : 'Send a confirmed profile from HireSense before filling a page.',
    Boolean(response?.profile),
  )
})

fillButton.addEventListener('click', () => {
  setStatus('Filling supported fields…', false)
  chrome.runtime.sendMessage({ type: 'fill-active-tab' }, (response) => {
    if (!response?.ok) {
      setStatus(response?.error || 'Could not fill this page.', true)
      return
    }
    const result = response.result
    setStatus(`Filled ${result.filled} fields · Preserved ${result.preserved} answers · ${result.needsInput} need your input`, true)
  })
})

clearButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear-profile' }, () => {
    setStatus('Profile cleared from this browser session.', false)
  })
})
