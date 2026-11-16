import type { FieldDecision } from './types'
import { displayField } from './fieldLabels'

export const outcomeLabels = {
  fill: 'Ready', preserve: 'Already answered', missing: 'Needs your detail',
  ambiguous: 'Needs your review', unsupported: 'Left untouched', sensitive: 'Left for you', invalid: 'Needs your review',
}

const profileLabels: Record<string, string> = {
  fullName: 'Full name', firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone',
  city: 'City', state: 'State / Province', country: 'Country of residence', addressLine1: 'Street address',
  addressLine2: 'Apartment / Suite', postalCode: 'ZIP / Postal code', linkedin: 'LinkedIn', github: 'GitHub',
  portfolio: 'Portfolio', skills: 'Skills', school: 'School', degree: 'Degree', fieldOfStudy: 'Field of study',
  educationStart: 'Education start date', educationEnd: 'Graduation date', company: 'Employer', jobTitle: 'Job title',
  workLocation: 'Work location', employmentStart: 'Employment start date', employmentEnd: 'Employment end date',
}
const resultLabels = {
  attached: 'Attached to file field',
  filled: 'Filled & verified', preserved: 'Answer preserved', skipped: 'Left for you',
  changed: 'Changed since preview', 'write-failed': 'Could not fill', 'verification-failed': 'Could not verify',
}

export function reportField(decision: FieldDecision) {
  return {
    label: decision.attachment ? 'Resume / CV' : displayField(decision.element),
    section: decision.result === 'filled' || decision.result === 'attached' || decision.outcome === 'preserve' ? 'handled'
      : decision.outcome === 'fill' && !decision.result ? 'ready'
      : ['ambiguous', 'invalid'].includes(decision.outcome) || ['changed', 'write-failed', 'verification-failed'].includes(decision.result ?? '') ? 'review'
        : decision.manual || ['missing', 'sensitive'].includes(decision.outcome) ? 'manual' : 'untouched',
    status: decision.result && decision.result !== 'skipped' ? resultLabels[decision.result] : decision.manual ? 'Left for you' : outcomeLabels[decision.outcome],
    reason: decision.reason,
    mapping: decision.profileKey ? profileLabels[decision.profileKey] ?? decision.profileKey : undefined,
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
    (count('missing', 'ambiguous', 'invalid', 'sensitive') + decisions.filter((d) => d.manual && !d.attachment).length) + ' questions need you · ' + decisions.filter((d) => d.outcome === 'unsupported' && !d.manual).length + ' untouched'
}
