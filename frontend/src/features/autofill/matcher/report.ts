import type { FieldDecision } from './types'
import { displayField } from './fieldLabels'

export const outcomeLabels = {
  fill: 'Will fill', preserve: 'Already answered', missing: 'Needs your detail',
  ambiguous: 'Needs your review', unsupported: 'Left untouched', sensitive: 'Left for you', invalid: 'Needs your review',
}
const resultLabels = {
  filled: 'Filled & verified', preserved: 'Answer preserved', skipped: 'Left for you',
  changed: 'Changed since preview', 'write-failed': 'Could not fill', 'verification-failed': 'Could not verify',
}

export function reportField(decision: FieldDecision) {
  return {
    label: displayField(decision.element),
    status: decision.result && decision.result !== 'skipped' ? resultLabels[decision.result] : decision.manual ? 'Left for you' : outcomeLabels[decision.outcome],
    reason: decision.reason,
    tone: decision.result === 'filled' ? 'fill' : ['changed', 'write-failed', 'verification-failed'].includes(decision.result ?? '') ? 'invalid' : decision.outcome,
    value: decision.outcome === 'fill' && !decision.result
      ? decision.element instanceof HTMLSelectElement
        ? Array.from(decision.element.options).find((option) => option.value === decision.value)?.text ?? decision.value
        : decision.value
      : undefined,
  }
}

export function previewSummary(decisions: FieldDecision[]) {
  const count = (...outcomes: FieldDecision['outcome'][]) => decisions.filter((d) => outcomes.includes(d.outcome)).length
  return count('fill') + ' ready to fill · ' + count('preserve') + ' already answered · ' +
    (count('missing', 'ambiguous', 'invalid', 'sensitive') + decisions.filter((d) => d.manual).length) + ' need you · ' + decisions.filter((d) => d.outcome === 'unsupported' && !d.manual).length + ' untouched'
}
