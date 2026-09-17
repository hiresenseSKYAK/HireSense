// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeApplicantProfile } from '../core/profile'
import { matchApplicationFields } from './semanticMatcher'
import { displayField } from './fieldLabels'
import { executeAutofill, executeAutofillVerified } from './fillExecutor'
import { reportField } from './report'

const profile = { ...initializeApplicantProfile(null), fullName: 'Ada Lovelace', email: 'ada@example.com', state: 'Texas', phone: '+1 555 123 4567' }
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
function form(html: string) { document.body.innerHTML = html; return document.body }

describe('safe labels and conventional application controls', () => {
  it('uses the actual wrapping label without option or textarea contents', () => {
    form('<label>State / Province<select name="state"><option value="">Email Phone</option><option value="TX">Texas</option></select></label><label>Why this role?<textarea>My answer</textarea></label>')
    const decisions = matchApplicationFields(document.body, profile)
    expect(displayField(decisions[0].element)).toBe('State / Province')
    expect(decisions[0].outcome).toBe('fill')
    expect(displayField(decisions[1].element)).toBe('Why this role?')
    expect(reportField(decisions[0]).label).not.toContain('Texas')
  })
  it('reads accessible labels without concatenating options', () => {
    form('<span id="question">State / Province</span><select aria-labelledby="question"><option value=""></option><option value="TX">Texas</option></select>')
    expect(displayField(matchApplicationFields(document.body, profile)[0].element)).toBe('State / Province')
  })
  it('matches branded professional links from readable labels alone', () => {
    form('<label>GitHub URL<input type="url"></label><label>LinkedIn URL<input type="url"></label>')
    expect(matchApplicationFields(document.body, profile).map((d) => d.profileKey)).toEqual(['github', 'linkedin'])
  })
  it('refuses ambiguous select options', () => {
    form('<label>State<select><option value=""></option><option value="TX">Texas</option><option value="Texas">Texas region</option></select></label>')
    expect(matchApplicationFields(document.body, profile)[0].outcome).toBe('invalid')
  })
  it('recognizes section-prefixed autocomplete', () => {
    form('<input autocomplete="section-applicant shipping email">')
    expect(matchApplicationFields(document.body, profile)[0].profileKey).toBe('email')
  })
  it('skips hidden ancestors, CSS-hidden controls and disabled fieldsets', () => {
    form('<div hidden><input name="email"></div><div style="display:none"><input name="email"></div><input style="visibility:hidden" name="email"><fieldset disabled><input name="email"></fieldset><div inert><input name="email"></div>')
    expect(matchApplicationFields(document.body, profile).every((d) => d.outcome === 'unsupported')).toBe(true)
  })
  it('keeps nested reference contacts manual', () => {
    form('<fieldset><legend>Professional references</legend><section><h3>Contact details</h3><input autocomplete="email"></section></fieldset>')
    expect(matchApplicationFields(document.body, profile)[0].outcome).toBe('sensitive')
  })
  it('honors accessible group context for external reference forms', () => {
    form('<span id="group-title">Professional references</span><div role="group" aria-labelledby="group-title"><label>Email<input type="email"></label></div>')
    expect(matchApplicationFields(document.body, profile)[0].outcome).toBe('sensitive')
  })
  it.each(['work authorization', 'sponsorship', 'race', 'ethnicity', 'gender', 'disability', 'veteran status', 'legal declaration', 'consent', 'emergency contact'])('never uses applicant metadata to answer %s', (label) => {
    form('<label>' + label + '<input autocomplete="name"></label>')
    expect(matchApplicationFields(document.body, profile)[0].outcome).toBe('sensitive')
  })
  it.each(['Favorite color', 'First job title', 'Preferred city', 'Why should we hire you?'])('keeps screening question %s manual despite autocomplete', (label) => {
    form('<label>' + label + '<input autocomplete="name"></label>')
    expect(matchApplicationFields(document.body, profile)[0].outcome).toBe('unsupported')
  })
  it('does not fill disabled select options or multi-selects', () => {
    form('<label>State<select><option value=""></option><option disabled value="TX">Texas</option></select></label><label>State<select multiple><option value="TX">Texas</option></select></label>')
    expect(matchApplicationFields(document.body, profile).map((d) => d.outcome)).toEqual(['invalid', 'unsupported'])
  })
})

describe('preview approval and honest results', () => {
  it('does not fill newly added fields that were never previewed', () => {
    const root = form('<input name="email">')
    const preview = matchApplicationFields(root, profile)
    root.insertAdjacentHTML('beforeend', '<input name="phone">')
    expect(executeAutofill(root, profile, preview).filled).toBe(1)
    expect(document.querySelector<HTMLInputElement>('[name=phone]')!.value).toBe('')
  })
  it('rejects metadata changes and preserves edits made after preview', () => {
    const root = form('<input name="email"><input name="phone">')
    const preview = matchApplicationFields(root, profile)
    preview[0].element.name = 'reference_email'
    preview[1].element.value = 'My answer'
    const result = executeAutofill(root, profile, preview)
    expect(result.changed).toBe(2)
    expect(result.filled).toBe(0)
    expect(preview[1].element.value).toBe('My answer')
    expect(reportField(result.decisions[0]).status).toBe('Changed since preview')
  })
  it('rejects detached fields and revalidates after another write changes the page', () => {
    const root = form('<input name="email"><input name="phone">')
    const preview = matchApplicationFields(root, profile)
    preview[0].element.addEventListener('input', () => preview[1].element.remove())
    const result = executeAutofill(root, profile, preview)
    expect(result.filled).toBe(1)
    expect(result.changed).toBe(1)
  })
  it('reports write failures separately and continues safely', () => {
    const root = form('<input name="email">')
    const preview = matchApplicationFields(root, profile)
    vi.spyOn(HTMLInputElement.prototype, 'value', 'set').mockImplementation(() => { throw new Error('rejected') })
    const result = executeAutofill(root, profile, preview)
    expect(result.writeFailures).toBe(1)
    expect(result.filled).toBe(0)
  })
  it('detects framework resets before reporting success', async () => {
    const root = form('<input name="email">')
    const input = root.querySelector('input')!
    input.addEventListener('input', () => setTimeout(() => { input.value = '' }, 0))
    const result = await executeAutofillVerified(root, profile, matchApplicationFields(root, profile))
    expect(result.filled).toBe(0)
    expect(result.verificationFailures).toBe(1)
  })
  it('does not invoke submission, next buttons, or clicks while filling', () => {
    const root = form('<form><input name="email"><button type="submit">Submit</button><button type="button">Next</button></form>')
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit')
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit')
    const click = vi.spyOn(HTMLElement.prototype, 'click')
    executeAutofill(root, profile, matchApplicationFields(root, profile))
    expect(submit).not.toHaveBeenCalled()
    expect(requestSubmit).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })
})
