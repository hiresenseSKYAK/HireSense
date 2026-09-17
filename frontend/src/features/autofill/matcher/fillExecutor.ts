import type { ApplicantProfile } from '../core/types'
import { matchApplicationFields } from './semanticMatcher'
import { verifiedValue } from './verification'
import type { ApplicationControl, FieldDecision, FillResult } from './types'

function setControlValue(element: ApplicationControl, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('No native value setter')
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

export function summarizeResult(decisions: FieldDecision[]): FillResult {
  const count = (result: FieldDecision['result']) => decisions.filter((d) => d.result === result).length
  return {
    decisions,
    filled: count('filled'), preserved: decisions.filter((d) => d.result === 'preserved' && !d.attachment).length, skipped: count('skipped'),
    needsInput: decisions.filter((d) => !d.attachment && (d.manual || ['missing', 'ambiguous', 'invalid', 'sensitive'].includes(d.outcome) ||
      ['changed', 'write-failed', 'verification-failed'].includes(d.result ?? ''))).length,
    verificationFailures: count('verification-failed'), writeFailures: count('write-failed'), changed: count('changed'),
  }
}

export function executeAutofill(root: ParentNode, profile: ApplicantProfile, preview?: FieldDecision[]): FillResult {
  const approved = preview ?? matchApplicationFields(root, profile)
  const decisions = approved.map((decision): FieldDecision => {
    if (decision.result === 'attached') return decision
    if (decision.outcome !== 'fill') return {
      ...decision, result: decision.outcome === 'preserve' ? 'preserved' : 'skipped',
      reason: decision.outcome === 'preserve' ? 'Your existing answer was preserved.' : decision.reason,
    }
    // Reinspect before each write: an earlier input event can change the form.
    const current = matchApplicationFields(root, profile).find((d) => d.element === decision.element)
    if (!current || !decision.element.isConnected || current.snapshot !== decision.snapshot) {
      return { ...decision, result: 'changed', reason: 'This field changed after preview. Preview again before filling it.' }
    }
    try {
      setControlValue(decision.element, decision.value!)
    } catch {
      return { ...decision, result: 'write-failed', reason: 'This page did not accept the write. Enter this answer yourself.' }
    }
    if (!verifiedValue(decision)) {
      return { ...decision, result: 'verification-failed', reason: 'The page did not retain the expected value. Please check this answer.' }
    }
    return { ...decision, result: 'filled', reason: 'Your profile value was filled and verified.' }
  })
  return summarizeResult(decisions)
}

// Let framework-controlled inputs settle before reporting success. Later site changes
// remain possible; users still review the actual application before submitting.
export async function executeAutofillVerified(root: ParentNode, profile: ApplicantProfile, preview: FieldDecision[]): Promise<FillResult> {
  const result = executeAutofill(root, profile, preview)
  await new Promise((resolve) => setTimeout(resolve, 120))
  return summarizeResult(result.decisions.map((decision) => decision.result === 'filled' &&
    !verifiedValue(decision)
    ? { ...decision, result: 'verification-failed', reason: 'The page changed this value after filling. Please enter it yourself.' } : decision))
}
