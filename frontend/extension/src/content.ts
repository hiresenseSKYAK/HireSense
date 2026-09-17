import { executeAutofill } from '../../src/features/autofill/matcher/fillExecutor'
import type { ApplicantProfile } from '../../src/features/autofill/core/types'

const bridgeWindow = window as typeof window & { __hireSenseAutofillListener?: boolean }

if (!bridgeWindow.__hireSenseAutofillListener) {
  bridgeWindow.__hireSenseAutofillListener = true
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'fill-supported-fields') {
      return
    }
    const result = executeAutofill(document, message.profile as ApplicantProfile)
    sendResponse({
      filled: result.filled,
      preserved: result.preserved,
      needsInput: result.needsInput,
      skipped: result.skipped,
      verificationFailures: result.verificationFailures,
    })
  })
}
