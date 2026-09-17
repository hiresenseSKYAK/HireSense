// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { initializeApplicantProfile } from '../core/profile'
import { matchApplicationFields } from './semanticMatcher'
import { executeAutofillVerified } from './fillExecutor'
import { equivalentPhone } from './verification'

// Wording and accessible control structure observed on the pilot, without company/job IDs.
const itar = 'The person hired will have access to information and items controlled by the International Traffic in Arms Regulation (ITAR). To conform to U.S. Government space technology export regulations, including the ITAR, you must be a U.S. citizen, lawful permanent resident of the U.S. (i.e., current Green Card holder), lawfully admitted into the U.S. as a refugee or granted asylum, or be eligible to obtain the required authorizations from the U.S. Department of State. Are you currently a U.S. Person as described above, or otherwise eligible to obtain the required authorization?'
const profile = {
  ...initializeApplicantProfile(null), fullName: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace',
  email: 'ada@example.com', phone: '(202) 555-0147', city: 'Austin', state: 'Texas', country: 'United States',
  addressLine1: '100 Example St', addressLine2: 'Apt 2', postalCode: '78701', linkedin: 'https://linkedin.com/in/example',
}
afterEach(() => document.body.replaceChildren())
function decide(html: string) {
  document.body.innerHTML = html
  return matchApplicationFields(document.body, profile)
}

describe('export eligibility is always manual', () => {
  it('classifies the exact ITAR label before the embedded State alias', () => {
    const [decision] = decide('<label id="question-label">' + itar + '</label><input role="combobox" type="text" aria-labelledby="question-label">')
    expect(decision.outcome).toBe('sensitive')
    expect(decision.value).toBeUndefined()
    expect(decision.element.value).toBe('')
  })
  it.each(['ITAR eligible?', 'Export-controlled information', 'Export control authorization', 'Export regulations',
    'U.S. Person', 'US Person', 'Citizenship status', 'Lawful permanent resident', 'Green Card holder', 'Permanent residency',
    'Refugee or asylum status', 'State Department authorization', 'Immigration eligibility', 'Security clearance',
    'Government eligibility', 'Work authorization', 'Sponsorship', 'Race / ethnicity', 'Hispanic / Latino'])('blocks %s despite misleading applicant metadata', (wording) => {
    expect(decide('<label>' + wording + '<input name="state" autocomplete="address-level1"></label>')[0].outcome).toBe('sensitive')
  })
  it('reads eligibility in described-by text and single-question wrappers', () => {
    const decisions = decide('<span id="terms">ITAR export eligibility</span><label>State<input aria-describedby="terms" autocomplete="address-level1"></label><div><label>Country<input autocomplete="country"></label><p>Permanent resident or asylum status</p></div>')
    expect(decisions.map((d) => d.outcome)).toEqual(['sensitive', 'sensitive'])
  })
  it('never fills sensitive textareas either', () => {
    expect(decide('<label>ITAR eligibility<textarea></textarea></label>')[0].outcome).toBe('sensitive')
  })
})

describe('known factual fields and real-world control shapes', () => {
  it('initializes new personal fields blank rather than deriving them from raw resume text', () => {
    const values = initializeApplicantProfile({ parsed_data: { name: 'Ada', country: 'USA', address: '100 Street', postalCode: '12345' } })
    expect([values.country, values.addressLine1, values.addressLine2, values.postalCode]).toEqual(['', '', '', ''])
  })
  it('matches confirmed address data, postal codes and native country options', () => {
    const decisions = decide('<label>Street address<input name="address_line_1"></label><label>Apartment / Suite<input autocomplete="address-line2"></label><label>ZIP / Postal code<input autocomplete="postal-code"></label><label>Country of residence<select><option value="">Choose</option><option value="US">United States</option></select></label>')
    expect(decisions.map((d) => d.value)).toEqual(['100 Example St', 'Apt 2', '78701', 'US'])
  })
  it('keeps country and city search widgets manual, rather than treating search text as a selected answer', () => {
    const decisions = decide('<label id="country-label">Country</label><input id="country" role="combobox" aria-labelledby="country-label"><label id="location-label">Location (City)</label><input id="candidate-location" role="combobox" aria-labelledby="location-label">')
    expect(decisions.every((d) => d.outcome === 'unsupported')).toBe(true)
  })
  it('fills ordinary Greenhouse-style name/email/link inputs', async () => {
    const decisions = decide('<label for="first_name">First Name</label><input id="first_name"><label for="last_name">Last Name</label><input id="last_name"><input type="email" aria-label="Email"><label for="question-link">LinkedIn Profile</label><input id="question-link">')
    expect((await executeAutofillVerified(document.body, profile, decisions)).filled).toBe(4)
  })
  it('discovers the native resume file input without treating Cover Letter as a resume', () => {
    const decisions = decide('<label for="resume">Attach</label><input id="resume" type="file" accept=".pdf,.docx"><label for="cover_letter">Attach</label><input id="cover_letter" type="file">')
    expect(decisions[0].attachment).toBe(true)
    expect(decisions[1].attachment).toBe(false)
    expect(decisions.every((d) => d.outcome !== 'fill')).toBe(true)
  })
})

describe('phone verification without losing identity', () => {
  it.each([['(346) 313-0847', '3463130847'], ['+1 (202) 555-0147', '+12025550147'], ['202.555.0147', '202-555-0147']])('accepts punctuation-only changes from %s to %s', (a, b) => expect(equivalentPhone(a, b)).toBe(true))
  it.each([['+12025550147', '2025550147'], ['2025550147', '2025550148'], ['2025550147', '5550147'], ['2025550147', '2025550147 ext 2'], ['2025550147', ''], ['02025550147', '2025550147']])('rejects changed digits, codes or extensions', (a, b) => expect(equivalentPhone(a, b)).toBe(false))
  it('verifies an intl-tel-input-style digits-only rewrite using normal input events', async () => {
    const [decision] = decide('<input id="phone" type="tel" aria-label="Phone" data-intl-tel-input-id="0">')
    decision.element.addEventListener('input', () => { decision.element.value = decision.element.value.replace(/\D/g, '') })
    const result = await executeAutofillVerified(document.body, profile, [decision])
    expect(result.filled).toBe(1)
    expect(result.verificationFailures).toBe(0)
  })
})
