import type { ApplicantProfile } from '../core/types'
import { matchApplicationFields } from './semanticMatcher'
import type { ApplicationControl, FieldDecision, FillResult } from './types'

function setControlValue(element: ApplicationControl, value: string) {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function count(decisions: FieldDecision[], outcome: FieldDecision['outcome']): number {
  return decisions.filter((decision) => decision.outcome === outcome).length
}

export function executeAutofill(
  root: ParentNode,
  profile: ApplicantProfile,
): FillResult {
  const decisions = matchApplicationFields(root, profile).map((decision) => {
    if (decision.outcome !== 'fill' || !decision.value || !decision.element.isConnected) {
      return decision
    }

    setControlValue(decision.element, decision.value)
    if (decision.element.value !== decision.value) {
      return {
        ...decision,
        outcome: 'invalid' as const,
        reason: 'HireSense could not verify the value after filling this field.',
      }
    }
    return decision
  })

  return {
    decisions,
    filled: count(decisions, 'fill'),
    preserved: count(decisions, 'preserve'),
    needsInput:
      count(decisions, 'missing') + count(decisions, 'ambiguous') + count(decisions, 'invalid'),
    skipped: count(decisions, 'unsupported') + count(decisions, 'sensitive'),
    verificationFailures: decisions.filter(
      (decision) => decision.reason === 'HireSense could not verify the value after filling this field.',
    ).length,
  }
}
