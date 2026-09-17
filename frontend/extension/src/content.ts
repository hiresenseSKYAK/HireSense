import { executeAutofillVerified } from '../../src/features/autofill/matcher/fillExecutor'
import { matchApplicationFields } from '../../src/features/autofill/matcher/semanticMatcher'
import { previewSummary, reportField } from '../../src/features/autofill/matcher/report'
import { profileExpired, transferableProfile } from '../../src/features/autofill/bridgeContract'
import { attachResume } from '../../src/features/autofill/resume/attachment'
import { validResume } from '../../src/features/autofill/resume/contract'
import type { FieldDecision } from '../../src/features/autofill/matcher/types'

const bridgeWindow = window as typeof window & { __hireSenseAutofillListener?: boolean }

if (!bridgeWindow.__hireSenseAutofillListener) {
  bridgeWindow.__hireSenseAutofillListener = true
  let preview: {
    decisions: FieldDecision[]; token: string; url: string; id: string;
    filled: boolean; attachmentUsed: boolean; summary?: string; resumeStatus: string;
  } | null = null
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !['preview-supported-fields', 'fill-supported-fields', 'attach-resume'].includes(message?.type)) return
    void (async () => {
      const profile = transferableProfile(message.profile)
      if (!profile || profileExpired(message.expiresAt)) throw new Error('Profile unavailable or expired. Send it again from HireSense.')
      if (message.type === 'preview-supported-fields') {
        const decisions = matchApplicationFields(document, profile)
        const files = decisions.filter((d) => d.attachment)
        const resumeStatus = files.some((d) => d.outcome === 'preserve') ? 'Existing resume preserved'
          : files.length === 1 ? 'Resume still needed' : 'Resume: use the site’s Attach button'
        preview = { decisions, token: message.token, url: location.href, id: crypto.randomUUID(), filled: false, attachmentUsed: false, resumeStatus }
        return { ok: true, previewId: preview.id, summary: previewSummary(decisions),
          ready: decisions.filter((d) => d.outcome === 'fill').length,
          attachmentReady: files.length === 1 && files[0].outcome !== 'preserve',
          resumeStatus, fields: decisions.map(reportField) }
      }
      if (!preview || preview.token !== message.token || preview.url !== location.href || preview.id !== message.previewId) {
        throw new Error('The page or profile changed. Preview this application again.')
      }
      const current = preview
      if (message.type === 'attach-resume') {
        const files = current.decisions.filter((d) => d.attachment && d.outcome !== 'preserve')
        if (current.attachmentUsed || files.length !== 1 || !validResume(message.resume) || profileExpired(message.resumeExpiresAt)) {
          throw new Error('Resume attachment needs a new preview and one unambiguous file field.')
        }
        current.attachmentUsed = true
        const result = await attachResume(document, profile, files[0], message.resume)
        current.resumeStatus = result.message
        if (result.attached) {
          current.decisions = current.decisions.map((d) => d === files[0]
            ? { ...d, result: 'attached', manual: false, outcome: 'preserve', reason: result.message } : d)
        }
        return { ok: true, attached: result.attached, resumeStatus: current.resumeStatus, fields: current.decisions.map(reportField) }
      }
      if (current.filled) throw new Error('These fields were already processed. Preview again.')
      current.filled = true
      const result = await executeAutofillVerified(document, profile, current.decisions)
      current.decisions = result.decisions
      current.summary = result.filled + ' fields filled & verified · ' + result.preserved + ' preserved · ' + result.needsInput + ' questions need you'
      return { ok: true, summary: current.summary, resumeStatus: current.resumeStatus, fields: result.decisions.map(reportField) }
    })().then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Could not prepare this page.' }))
    return true
  })
}
