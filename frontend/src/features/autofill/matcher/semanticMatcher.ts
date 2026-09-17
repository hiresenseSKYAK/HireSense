import { validateApplicantProfile } from '../core/profile'
import type { ApplicantProfile } from '../core/types'
import type {
  ApplicationControl,
  FieldDecision,
  MatchEvidence,
} from './types'

const aliases: Record<keyof ApplicantProfile, string[]> = {
  fullName: ['full name', 'legal name', 'applicant name'],
  firstName: ['first name', 'given name', 'first'],
  lastName: ['last name', 'family name', 'surname', 'last'],
  email: ['email address', 'email'],
  phone: ['phone number', 'mobile number', 'mobile', 'phone', 'telephone'],
  city: ['city town', 'city'],
  state: ['state province', 'state', 'province'],
  linkedin: ['linkedin url', 'linkedin'],
  github: ['github url', 'github'],
  portfolio: ['portfolio website', 'personal website', 'website url', 'portfolio', 'website'],
}

const autocompleteMap: Record<string, keyof ApplicantProfile> = {
  name: 'fullName',
  'given-name': 'firstName',
  'family-name': 'lastName',
  email: 'email',
  tel: 'phone',
  'address-level2': 'city',
  'address-level1': 'state',
}

const referenceTerms = [
  'reference',
  'referee',
  'emergency contact',
  'emergency',
  'relationship',
]

const sensitiveTerms = [
  'work authorization',
  'authorized to work',
  'sponsorship',
  'race',
  'ethnicity',
  'gender',
  'disability',
  'veteran',
  'consent',
  'agree',
  'declaration',
  'citizenship',
  'criminal history',
  'background check',
]

function normalize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function containsPhrase(value: string, phrase: string): boolean {
  const normalizedValue = ` ${normalize(value)} `
  return normalizedValue.includes(` ${phrase} `)
}

function matchingKeys(value: string): Array<keyof ApplicantProfile> {
  return (Object.keys(aliases) as Array<keyof ApplicantProfile>).filter((key) =>
    aliases[key].some((alias) => containsPhrase(value, alias)),
  )
}

function addEvidence(
  evidence: MatchEvidence[],
  source: MatchEvidence['source'],
  text: string,
  keys: Array<keyof ApplicantProfile>,
) {
  keys.forEach((profileKey) => evidence.push({ source, text, profileKey }))
}

function getLabelText(element: ApplicationControl): string[] {
  const labels = Array.from(element.labels ?? []).map((label) => label.textContent ?? '')
  if (element.id) {
    const matchingForLabel = Array.from(
      element.ownerDocument.querySelectorAll('label'),
    ).find((label) => label.htmlFor === element.id)
    if (matchingForLabel && !labels.includes(matchingForLabel.textContent ?? '')) {
      labels.push(matchingForLabel.textContent ?? '')
    }
  }
  return labels.filter(Boolean)
}

function getAriaLabelText(element: ApplicationControl): string[] {
  const direct = element.getAttribute('aria-label')
  const labelledBy = element
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .filter(Boolean)
  return [direct ?? '', ...(labelledBy ?? [])].filter(Boolean)
}

function getSectionContext(element: ApplicationControl): string[] {
  const fieldset = element.closest('fieldset')
  const section = element.closest('section')
  const texts = [
    fieldset?.querySelector('legend')?.textContent ?? '',
    fieldset?.getAttribute('aria-label') ?? '',
    section?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ?? '',
    section?.getAttribute('aria-label') ?? '',
  ]
  return texts.filter(Boolean)
}

function isHidden(element: ApplicationControl): boolean {
  return (
    (element instanceof HTMLInputElement && element.type === 'hidden') ||
    element.hidden ||
    element.getAttribute('aria-hidden') === 'true'
  )
}

function isReadOnly(element: ApplicationControl): boolean {
  return (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.readOnly
  )
}

function controlType(element: ApplicationControl): string {
  return element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase()
}

function isCompatible(
  element: ApplicationControl,
  key: keyof ApplicantProfile,
): boolean {
  if (element instanceof HTMLSelectElement) {
    return key === 'state'
  }
  if (element instanceof HTMLTextAreaElement) {
    return false
  }

  const type = element.type
  if (['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].includes(type)) {
    return false
  }
  if (key === 'email') return ['email', 'text'].includes(type)
  if (key === 'phone') return ['tel', 'text'].includes(type)
  if (['linkedin', 'github', 'portfolio'].includes(key)) {
    return ['url', 'text'].includes(type)
  }
  return ['text', 'search'].includes(type)
}

function getStateSelectValue(
  select: HTMLSelectElement,
  value: string,
): string | null {
  const normalized = normalize(value)
  const stateNames: Record<string, string> = {
    al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
    co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
    hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas',
    ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts',
    mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
    ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico',
    ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
    or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
    sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
    va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
    dc: 'district of columbia',
  }
  const canonical = stateNames[normalized] ?? normalized
  const match = Array.from(select.options).find((option) => {
    const optionValue = normalize(option.value)
    const optionLabel = normalize(option.text)
    const optionCanonical = stateNames[optionValue] ?? optionValue
    return (
      optionValue === normalized ||
      optionLabel === normalized ||
      optionCanonical === canonical ||
      optionLabel === canonical
    )
  })
  return match?.value ?? null
}

function getMetadataEvidence(element: ApplicationControl): MatchEvidence[] {
  const evidence: MatchEvidence[] = []
  const autocomplete = element.getAttribute('autocomplete')?.trim().toLowerCase()
  if (autocomplete && autocompleteMap[autocomplete]) {
    evidence.push({
      source: 'autocomplete',
      text: autocomplete,
      profileKey: autocompleteMap[autocomplete],
    })
  }

  getLabelText(element).forEach((text) =>
    addEvidence(evidence, 'label', text, matchingKeys(text)),
  )
  getAriaLabelText(element).forEach((text) =>
    addEvidence(evidence, 'accessibility label', text, matchingKeys(text)),
  )
  if (element.getAttribute('name')) {
    const text = element.getAttribute('name') ?? ''
    addEvidence(evidence, 'name', text, matchingKeys(text))
  }
  if (element.id) addEvidence(evidence, 'id', element.id, matchingKeys(element.id))
  if (element.getAttribute('placeholder')) {
    const text = element.getAttribute('placeholder') ?? ''
    addEvidence(evidence, 'placeholder', text, matchingKeys(text))
  }
  getSectionContext(element).forEach((text) =>
    evidence.push({ source: 'section context', text }),
  )
  evidence.push({ source: 'input type', text: controlType(element) })
  return evidence
}

function hasContextTerm(evidence: MatchEvidence[], terms: string[]): boolean {
  return evidence.some(
    (item) =>
      item.source === 'section context' &&
      terms.some((term) => containsPhrase(item.text, term)),
  )
}

function fieldHasTerm(evidence: MatchEvidence[], terms: string[]): boolean {
  return evidence.some((item) => terms.some((term) => containsPhrase(item.text, term)))
}

export function discoverApplicationFields(root: ParentNode = document): ApplicationControl[] {
  return Array.from(root.querySelectorAll('input, select, textarea')) as ApplicationControl[]
}

export function matchApplicationFields(
  root: ParentNode,
  profile: ApplicantProfile,
): FieldDecision[] {
  const validationErrors = validateApplicantProfile(profile)

  return discoverApplicationFields(root).map((element) => {
    const evidence = getMetadataEvidence(element)

    if (isHidden(element)) {
      return { element, outcome: 'unsupported', reason: 'Hidden fields are never changed.', evidence }
    }
    if (element.disabled) {
      return { element, outcome: 'unsupported', reason: 'Disabled fields cannot be changed.', evidence }
    }
    if (isReadOnly(element)) {
      return { element, outcome: 'unsupported', reason: 'Read-only fields are preserved.', evidence }
    }
    if (element instanceof HTMLTextAreaElement) {
      return { element, outcome: 'unsupported', reason: 'Free-text questions need your answer.', evidence }
    }
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
      return { element, outcome: 'sensitive', reason: 'Checkboxes and choices are never answered automatically.', evidence }
    }
    if (hasContextTerm(evidence, referenceTerms) || fieldHasTerm(evidence, referenceTerms)) {
      return { element, outcome: 'sensitive', reason: 'Reference and emergency-contact details are never filled.', evidence }
    }
    if (hasContextTerm(evidence, sensitiveTerms) || fieldHasTerm(evidence, sensitiveTerms)) {
      return { element, outcome: 'sensitive', reason: 'Sensitive or application-specific questions need your answer.', evidence }
    }

    const strongEvidence = evidence.filter((item) =>
      item.profileKey && item.source !== 'placeholder',
    )
    const matchedKeys = [...new Set(strongEvidence.map((item) => item.profileKey))] as Array<
      keyof ApplicantProfile
    >

    if (matchedKeys.length > 1) {
      return {
        element,
        outcome: 'ambiguous',
        reason: 'Conflicting field details point to more than one applicant value.',
        evidence,
      }
    }
    if (matchedKeys.length === 0) {
      return {
        element,
        outcome: 'unsupported',
        reason: 'HireSense could not identify this field safely.',
        evidence,
      }
    }

    const profileKey = matchedKeys[0]
    if (!isCompatible(element, profileKey)) {
      return {
        element,
        outcome: 'unsupported',
        reason: 'This field type is not compatible with the identified applicant value.',
        profileKey,
        evidence,
      }
    }
    if (element.value.trim() !== '') {
      return {
        element,
        outcome: 'preserve',
        reason: 'An existing answer will be preserved.',
        profileKey,
        evidence,
      }
    }
    if (validationErrors[profileKey]) {
      return {
        element,
        outcome: 'invalid',
        reason: 'The matching profile value is not valid for this field.',
        profileKey,
        evidence,
      }
    }

    const profileValue = profile[profileKey].trim()
    if (profileValue === '') {
      return {
        element,
        outcome: 'missing',
        reason: 'This applicant detail is blank in your profile.',
        profileKey,
        evidence,
      }
    }

    const value =
      element instanceof HTMLSelectElement && profileKey === 'state'
        ? getStateSelectValue(element, profileValue)
        : profileValue
    if (value === null) {
      return {
        element,
        outcome: 'invalid',
        reason: 'Your state does not match an available option.',
        profileKey,
        evidence,
      }
    }

    return {
      element,
      outcome: 'fill',
      reason: 'A supported applicant value was identified from the form details.',
      profileKey,
      value,
      evidence,
    }
  })
}
