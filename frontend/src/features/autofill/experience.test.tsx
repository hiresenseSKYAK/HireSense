// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfileReview from './ProfileReview'
import ControlledApplicationPage from './ControlledApplicationPage'
import { initializeApplicantProfile } from './core/profile'
import type { ResumeUploadResponse } from '../../api/resume'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
afterEach(() => { if (root) act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })
function render(node: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container); act(() => root.render(node))
}
function button(text: string) { return Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text))! }
function click(element: HTMLElement) { act(() => element.click()) }
const resume = { filename: 'ada-resume.pdf', parsed_data: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+1 555 123 4567' } } as ResumeUploadResponse
const profile = { ...initializeApplicantProfile(resume), firstName: 'Ada', lastName: 'Lovelace', state: 'Texas' }

describe('applicant review experience', () => {
  it('shows provenance, confirmation, and invalidates edits while allowing spaces', () => {
    const next = vi.fn()
    render(<ProfileReview resume={resume} onContinue={next} />)
    expect(document.body.textContent).toContain('ada-resume.pdf')
    expect(document.body.textContent).toContain('From resume')
    expect(button('Confirm my information').disabled).toBe(true)
    click(document.querySelector<HTMLInputElement>('[type=checkbox]')!)
    click(button('Confirm my information'))
    expect(document.body.textContent).toContain('Your profile is ready')
    click(button('Preview application'))
    expect(next).toHaveBeenCalledWith(initializeApplicantProfile(resume))
    const input = document.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Ada ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value).toBe('Ada ')
    expect(document.body.textContent).toContain('Changes need confirmation')
    expect(button('Confirm my information').disabled).toBe(true)
    expect(document.body.textContent).not.toContain('Your profile is ready')
  })
  it('returns draft details without silently confirming them', () => {
    render(<ProfileReview resume={resume} draft={profile} onContinue={() => {}} />)
    expect(document.querySelector<HTMLInputElement>('[autocomplete=given-name]')!.value).toBe('Ada')
    expect(button('Confirm my information').disabled).toBe(true)
  })
})

describe('controlled application flow', () => {
  it.each(['Classic ATS', 'Compact application'])('previews and verifies %s without submission', async (layout) => {
    render(<MemoryRouter initialEntries={[{ pathname: '/application/demo', state: { profile } }]}><ControlledApplicationPage /></MemoryRouter>)
    click(button(layout))
    expect(button('Fill ')).toBeUndefined()
    click(button('Preview autofill'))
    expect(document.body.textContent).toContain('Will fill')
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit')
    await act(async () => { button('supported fields').click(); await new Promise((resolve) => setTimeout(resolve, 180)) })
    expect(document.body.textContent).toContain('Filled & verified')
    expect(document.body.textContent).not.toContain('Will fill')
    expect(document.body.textContent).toContain('Review every answer before you submit')
    expect(submit).not.toHaveBeenCalled()
    click(button('Preview again'))
    expect(button('supported fields').disabled).toBe(true)
    expect(document.body.textContent).toContain('Already answered')
  })
  it('requires a reviewed profile for direct entry', () => {
    render(<MemoryRouter><ControlledApplicationPage /></MemoryRouter>)
    expect(document.body.textContent).toContain('Review my profile')
    expect(button('Preview autofill')).toBeUndefined()
  })
})
