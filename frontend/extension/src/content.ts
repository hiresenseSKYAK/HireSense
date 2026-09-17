import { executeAutofillVerified } from '../../src/features/autofill/matcher/fillExecutor'
import { matchApplicationFields } from '../../src/features/autofill/matcher/semanticMatcher'
import { previewSummary, reportField } from '../../src/features/autofill/matcher/report'
import { profileExpired, transferableProfile } from '../../src/features/autofill/bridgeContract'
import type { FieldDecision } from '../../src/features/autofill/matcher/types'

const bridgeWindow = window as typeof window & { __hireSenseAutofillListener?: boolean }

if (!bridgeWindow.__hireSenseAutofillListener) {
  bridgeWindow.__hireSenseAutofillListener = true
  let preview: { decisions: FieldDecision[]; token: string; url: string; id: string } | null = null
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !['preview-supported-fields', 'fill-supported-fields'].includes(message?.type)) return
    void (async () => {
      const profile = transferableProfile(message.profile)
      if (!profile || profileExpired(message.expiresAt)) throw new Error('Profile unavailable or expired. Send it again from HireSense.')
      if (message.type === 'preview-supported-fields') {
        const decisions = matchApplicationFields(document, profile)
        preview = { decisions, token: message.token, url: location.href, id: crypto.randomUUID() }
        return { ok: true, previewId: preview.id, summary: previewSummary(decisions), ready: decisions.filter((d) => d.outcome === 'fill').length, fields: decisions.map(reportField) }
      }
      if (!preview || preview.token !== message.token || preview.url !== location.href || preview.id !== message.previewId) {
        throw new Error('The page or profile changed. Preview this application again.')
      }
      const approved = preview.decisions
      preview = null
      const result = await executeAutofillVerified(document, profile, approved)
      return { ok: true, summary: result.filled + ' filled & verified · ' + result.preserved + ' preserved · ' + result.needsInput + ' need you',
        fields: result.decisions.map(reportField) }
    })().then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Could not prepare this page.' }))
    return true
  })
}
