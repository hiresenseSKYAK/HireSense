import { validateApplicantProfile } from '../core/profile'
import { fieldLabels as getLabelText, ariaLabels as getAriaLabelText } from './fieldLabels'
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
  country: ['country of residence', 'country region', 'country'],
  addressLine1: ['street address', 'address line 1', 'address1', 'address 1', 'street'],
  addressLine2: ['address line 2', 'address2', 'address 2', 'apartment', 'suite', 'unit'],
  postalCode: ['postal code', 'zip code', 'postcode', 'zip'],
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
  'country-name': 'country',
  country: 'country',
  'address-line1': 'addressLine1',
  'address-line2': 'addressLine2',
  'postal-code': 'postalCode',
}

const referenceTerms = [
  'reference',
  'references',
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
  'legal declaration',
  'sex',
  'ethnic',
  'citizenship',
  'criminal history',
  'background check',
  'itar', 'international traffic in arms', 'export control', 'export controls',
  'i t a r', 'export controlled', 'export compliance', 'export restrictions',
  'export regulation', 'export regulations', 'export administration',
  'u s person', 'us person', 'u s persons', 'us persons',
  'green card', 'permanent resident', 'permanent residency',
  'permanent residents', 'clearance',
  'refugee', 'asylum', 'asylee', 'state department', 'department of state',
  'immigration', 'security clearance', 'government eligibility',
  'nationality', 'citizen', 'citizens', 'hispanic', 'latino', 'latina',
  'national origin', 'ethnic background', 'sexual orientation',
]

function normalize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .toLowerCase()
    .replace(/\bgit hub\b/g, 'github')
    .replace(/\blinked in\b/g, 'linkedin')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function containsPhrase(value: string, phrase: string): boolean {
  const normalizedValue = ` ${normalize(value)} `
  return normalizedValue.includes(` ${phrase} `)
}

function matchingKeys(value: string): Array<keyof ApplicantProfile> {
  return (Object.keys(aliases) as Array<keyof ApplicantProfile>).filter((key) =>
    aliases[key].some((alias) => ['first', 'last'].includes(alias)
      ? normalize(value) === alias : containsPhrase(value, alias)),
  )
}

function addEvidence(
  evidence: MatchEvidence[],
  source: MatchEvidence['source'],
  text: string,
  keys: Array<keyof ApplicantProfile>,
) {
  // Keep unmatched text too: sensitive questions often have no applicant alias.
  if (keys.length === 0) evidence.push({ source, text })
  keys.forEach((profileKey) => evidence.push({ source, text, profileKey }))
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
  // Preserve reference/sensitive context through nested form groups.
  let ancestor = element.parentElement
  while (ancestor) {
    if (ancestor.matches('fieldset, section, [role="group"]')) {
      texts.push(...getAriaLabelText(ancestor))
      texts.push(ancestor.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4')?.textContent ?? '')
    }
    ancestor = ancestor.parentElement
  }
  return texts.filter(Boolean)
}

export function isHidden(element: ApplicationControl): boolean {
  let ancestor: Element | null = element
  while (ancestor) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(ancestor)
    if (ancestor.matches('[hidden], [aria-hidden="true"], [inert]') || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return true
    ancestor = ancestor.parentElement
  }
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
    return ['state', 'country'].includes(key) && !element.multiple
  }
  if (element instanceof HTMLTextAreaElement) {
    return false
  }

  const type = element.type
  if (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox') return false
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
  const matches = Array.from(select.options).filter((option) => {
    if (option.disabled || option.parentElement?.matches('optgroup:disabled') || !option.value) return false
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
  return matches.length === 1 ? matches[0].value : null
}

function getCountrySelectValue(select: HTMLSelectElement, value: string): string | null {
  // Match the confirmed country to an option, never derive it from a phone/address.
  const names: Record<string, string> = { us: 'united states', usa: 'united states', 'united states of america': 'united states', gb: 'united kingdom', uk: 'united kingdom', ca: 'canada', au: 'australia' }
  const canonical = (text: string) => names[normalize(text)] ?? normalize(text)
  const matches = Array.from(select.options).filter((option) => option.value && !option.disabled &&
    !option.parentElement?.matches('optgroup:disabled') &&
    [option.value, option.text].some((text) => canonical(text) === canonical(value)))
  return matches.length === 1 ? matches[0].value : null
}

function questionContext(element: ApplicationControl): string[] {
  const descriptions = (element.getAttribute('aria-describedby') ?? '').split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
  descriptions.push(element.getAttribute('aria-description') ?? '')
  // Capture explanatory text in a single-question wrapper, not the entire form.
  let wrapper = element.parentElement
  for (let depth = 0; wrapper && depth < 3; depth++, wrapper = wrapper.parentElement) {
    if (wrapper.matches('form, body, html') || wrapper.querySelectorAll('input:not([type="hidden"]), select, textarea').length !== 1) break
    const copy = wrapper.cloneNode(true) as Element
    copy.querySelectorAll('input, select, textarea, button, script, style').forEach((node) => node.remove())
    descriptions.push(copy.textContent ?? '')
  }
  return descriptions.filter(Boolean)
}

function getMetadataEvidence(element: ApplicationControl): MatchEvidence[] {
  const evidence: MatchEvidence[] = []
  const tokens = element.getAttribute('autocomplete')?.trim().toLowerCase().split(/\s+/).filter((token) => token !== 'webauthn')
  const autocomplete = tokens?.[tokens.length - 1]
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
  questionContext(element).forEach((text) => evidence.push({ source: 'question context', text }))
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

  return discoverApplicationFields(root).map((element): FieldDecision => {
    const evidence = getMetadataEvidence(element)

    if (isHidden(element)) {
      return { element, outcome: 'unsupported', reason: 'Hidden fields are never changed.', evidence }
    }
    if (element.disabled || element.matches(':disabled')) {
      return { element, outcome: 'unsupported', reason: 'Disabled fields cannot be changed.', evidence }
    }
    if (isReadOnly(element)) {
      return { element, outcome: 'unsupported', reason: 'Read-only fields are preserved.', evidence }
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
    if (element instanceof HTMLTextAreaElement) {
      return { element, outcome: 'unsupported', manual: true, reason: 'Free-text questions need your answer.', evidence }
    }
    if (element instanceof HTMLInputElement && element.type === 'file') {
      const texts = [...getLabelText(element), ...getAriaLabelText(element), element.name, element.id].join(' ')
      const resume = /\b(resume|cv|curriculum vitae)\b/.test(normalize(texts)) && !/\b(cover|letter|transcript|certificate)\b/.test(normalize(texts))
      return { element, outcome: element.files?.length ? 'preserve' : 'unsupported', manual: !element.files?.length,
        attachment: resume && !element.multiple, evidence,
        reason: element.files?.length ? 'An existing attachment will be preserved.' : resume ? 'Resume attachment needs your separate approval in the extension.' : 'Choose this attachment yourself.' }
    }
    const questions = [...getLabelText(element), ...getAriaLabelText(element)]
    if (questions.some((text) => /^(why|describe|tell|explain|how|what|which|would|have you|do you|are you|can you)\b/.test(normalize(text)) ||
      /\b(preferred|previous|employer|company|school|university|manager|salary|desired|birth)\b/.test(normalize(text)))) {
      return { element, outcome: 'unsupported', manual: true, reason: 'Screening questions need your own answer.', evidence }
    }
    if (questions.some((text) => matchingKeys(text).length === 0 && normalize(text) !== 'name')) {
      return { element, outcome: 'unsupported', manual: true, reason: 'The question does not clearly identify an applicant detail.', evidence }
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
        manual: true,
        evidence,
      }
    }

    const profileKey = matchedKeys[0]
    if (!isCompatible(element, profileKey)) {
      return {
        element,
        outcome: 'unsupported',
        reason: 'This field type is not compatible with the identified applicant value.',
        manual: true,
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
      element instanceof HTMLSelectElement
        ? profileKey === 'country' ? getCountrySelectValue(element, profileValue) : getStateSelectValue(element, profileValue)
        : profileValue
    if (value === null) {
      return {
        element,
        outcome: 'invalid',
        reason: 'Your confirmed location does not match a single available option.',
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
  }).map((decision) => ({ ...decision, snapshot: JSON.stringify([
    decision.evidence, decision.element.outerHTML, decision.element.value,
    decision.outcome, decision.profileKey, decision.value,
  ]) }))
}
