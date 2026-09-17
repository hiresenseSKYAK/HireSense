// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { executeAutofill } from './fillExecutor'
import { calculateMatcherMetrics } from './metrics'
import { matchApplicationFields } from './semanticMatcher'
import type { ApplicantProfile } from '../core/types'

const profile: ApplicantProfile = {
  fullName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+1 555 123 4567',
  city: 'Austin',
  state: 'Texas',
      country: '', addressLine1: '', addressLine2: '', postalCode: '',
  linkedin: 'https://www.linkedin.com/in/ada-lovelace',
  github: 'https://github.com/ada-lovelace',
  portfolio: 'https://ada.example.com',
}

afterEach(() => {
  document.body.replaceChildren()
})

function outcomes(root: ParentNode = document.body) {
  return matchApplicationFields(root, profile).map((decision) => ({
    id: decision.element.id,
    outcome: decision.outcome,
    profileKey: decision.profileKey,
  }))
}

describe('semantic application field matcher', () => {
  it('matches common aliases and autocomplete semantics', () => {
    document.body.innerHTML = `
      <label for="given">Given name</label><input id="given" />
      <input id="family" autocomplete="family-name" />
      <label for="mail">Email address</label><input id="mail" type="email" />
      <label for="mobile">Mobile number</label><input id="mobile" type="tel" />
    `

    expect(outcomes()).toEqual([
      { id: 'given', outcome: 'fill', profileKey: 'firstName' },
      { id: 'family', outcome: 'fill', profileKey: 'lastName' },
      { id: 'mail', outcome: 'fill', profileKey: 'email' },
      { id: 'mobile', outcome: 'fill', profileKey: 'phone' },
    ])
  })

  it('marks conflicting metadata and unknown fields instead of guessing', () => {
    document.body.innerHTML = `
      <label for="conflict">Email</label><input id="conflict" autocomplete="tel" />
      <label for="unknown">Favorite color</label><input id="unknown" />
    `

    expect(outcomes()).toEqual([
      { id: 'conflict', outcome: 'ambiguous', profileKey: undefined },
      { id: 'unknown', outcome: 'unsupported', profileKey: undefined },
    ])
  })

  it('never maps applicant details into reference or sensitive sections', () => {
    document.body.innerHTML = `
      <section aria-label="Professional references">
        <label for="reference-email">Email</label><input id="reference-email" type="email" />
      </section>
      <section aria-label="Work authorization">
        <label for="authorization">Are you authorized to work?</label><input id="authorization" />
      </section>
      <label for="consent">I agree to the declaration</label><input id="consent" type="checkbox" />
    `

    expect(outcomes().map((item) => item.outcome)).toEqual([
      'sensitive',
      'sensitive',
      'sensitive',
    ])
  })

  it('preserves existing answers and skips hidden, disabled, and readonly controls', () => {
    document.body.innerHTML = `
      <label for="city">City</label><input id="city" value="Dallas" />
      <label for="hidden-email">Email</label><input id="hidden-email" type="hidden" />
      <label for="disabled-phone">Phone</label><input id="disabled-phone" disabled />
      <label for="readonly-name">Full name</label><input id="readonly-name" readonly />
    `

    expect(outcomes()).toEqual([
      { id: 'city', outcome: 'preserve', profileKey: 'city' },
      { id: 'hidden-email', outcome: 'unsupported', profileKey: undefined },
      { id: 'disabled-phone', outcome: 'unsupported', profileKey: undefined },
      { id: 'readonly-name', outcome: 'unsupported', profileKey: undefined },
    ])
  })

  it('maps a full state name to a compatible state dropdown option', () => {
    document.body.innerHTML = `
      <label for="state">State / Province</label>
      <select id="state"><option value="">Choose one</option><option value="TX">Texas</option></select>
    `

    const [decision] = matchApplicationFields(document.body, profile)
    expect(decision.outcome).toBe('fill')
    expect(decision.profileKey).toBe('state')
    expect(decision.value).toBe('TX')
  })

  it('reports missing and invalid profile data without filling it', () => {
    document.body.innerHTML = `
      <label for="github">GitHub URL</label><input id="github" type="url" />
      <label for="email">Email</label><input id="email" type="email" />
    `
    const incomplete = { ...profile, github: '', email: 'bad email' }
    const decisions = matchApplicationFields(document.body, incomplete)

    expect(decisions.map((decision) => decision.outcome)).toEqual(['missing', 'invalid'])
  })

  it('previews without mutation, fills supported values, and verifies browser events', () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" type="email" />
      <label for="city">City</label><input id="city" />
    `
    const email = document.querySelector<HTMLInputElement>('#email')!
    let inputEvents = 0
    let changeEvents = 0
    email.addEventListener('input', () => inputEvents++)
    email.addEventListener('change', () => changeEvents++)

    const preview = matchApplicationFields(document.body, profile)
    expect(preview.every((decision) => decision.outcome === 'fill')).toBe(true)
    expect(email.value).toBe('')

    const result = executeAutofill(document.body, profile)
    expect(result.filled).toBe(2)
    expect(result.verificationFailures).toBe(0)
    expect(email.value).toBe('ada@example.com')
    expect(inputEvents).toBe(1)
    expect(changeEvents).toBe(1)
  })

  it('preserves edits made after preview and remains safe on repeat fills', () => {
    document.body.innerHTML = '<label for="city">City</label><input id="city" />'
    const city = document.querySelector<HTMLInputElement>('#city')!

    expect(matchApplicationFields(document.body, profile)[0].outcome).toBe('fill')
    city.value = 'Manual edit'
    expect(executeAutofill(document.body, profile).preserved).toBe(1)
    expect(city.value).toBe('Manual edit')

    city.value = ''
    expect(executeAutofill(document.body, profile).filled).toBe(1)
    expect(executeAutofill(document.body, profile).filled).toBe(0)
    expect(executeAutofill(document.body, profile).preserved).toBe(1)
  })

  it('never submits or advances an application form', () => {
    document.body.innerHTML = `
      <form><label for="name">Full name</label><input id="name" /><button type="submit">Submit</button></form>
    `
    const form = document.querySelector('form')!
    let submissions = 0
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submissions++
    })

    executeAutofill(document.body, profile)

    expect(submissions).toBe(0)
  })

  it('calculates correctness and coverage from independently authored expectations', () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" type="email" />
      <label for="unknown">Favorite color</label><input id="unknown" />
    `
    const decisions = matchApplicationFields(document.body, profile)
    const metrics = calculateMatcherMetrics(decisions, [
      { fieldId: 'email', outcome: 'fill', profileKey: 'email' },
      { fieldId: 'unknown', outcome: 'unsupported' },
    ])

    expect(metrics).toEqual({
      matchingCorrectness: { correctProposedMappings: 1, proposedMappings: 1, rate: 1 },
      supportedFieldCoverage: { correctProposedFills: 1, eligibleSupportedEmptyFields: 1, rate: 1 },
    })
  })
})
