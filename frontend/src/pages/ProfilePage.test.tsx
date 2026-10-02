// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResumeUploadResponse } from '../api/resume'
import { markAutofillProfileConfirmed } from '../features/autofill/readiness'
import ProfilePage from './ProfilePage'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const testState = vi.hoisted(() => ({ resume: null as ResumeUploadResponse | null }))

vi.mock('../api/jobs', () => ({
  fetchJobs: vi.fn(async () => ({
    items: [],
    total: 40,
    page: 1,
    pageSize: 1,
    cities: [],
    matchSummary: { strong: 12, average: 61, highest: 84, scored: 40 },
  })),
}))
vi.mock('../api/auth', () => ({
  getAuthSession: () => ({ token: 'test', user: { id: 1, username: 'Ada', email: 'ada@example.com', joined_at: '' } }),
  logout: vi.fn(async () => undefined),
}))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: () => testState.resume }))

const resume: ResumeUploadResponse = {
  filename: 'resume.pdf',
  parsed_data: {
    name: 'Ada Lovelace', email: 'ada@example.com', phone: '5551234567',
    skills: ['Python'], education: [], experience: [], projects: [], leadership: [],
    experience_entries: [], project_entries: [], leadership_entries: [],
  },
  analysis: { score: 80, summary: 'Strong foundation.', strengths: [], warnings: [], improvements: [] },
}

let root: Root | undefined

beforeEach(() => {
  sessionStorage.clear()
  testState.resume = resume
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function renderProfile() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MemoryRouter><ProfilePage /></MemoryRouter>)
    await Promise.resolve()
  })
}

describe('Profile page', () => {
  it('shows the account, resume, and a review prompt before autofill is confirmed', async () => {
    await renderProfile()
    expect(document.body.textContent).toContain('Name')
    expect(document.body.textContent).toContain('Ada')
    expect(document.body.textContent).toContain('Email')
    expect(document.body.textContent).toContain('ada@example.com')
    expect(document.body.textContent).toContain('Password')
    expect(document.body.textContent).toContain('••••••••')
    expect(document.body.textContent).toContain('resume.pdf')
    expect(document.body.textContent).toContain('Python')
    expect(document.body.textContent).toContain('12 strong matches, best 84%')
    const autofill = document.querySelector('[aria-label="Autofill readiness"]')
    expect(autofill?.textContent).toContain('Review')
    expect(autofill?.textContent).toContain('confirmation required before autofill')
    expect(document.body.textContent).not.toContain('Top opportunities')
    expect(document.body.textContent).not.toContain('Where opportunity is concentrated')
  })

  it('shows Ready only for a confirmed profile tied to the current resume', async () => {
    markAutofillProfileConfirmed(resume)
    await renderProfile()
    const autofill = document.querySelector('[aria-label="Autofill readiness"]')
    expect(autofill?.textContent).toContain('Ready')
    expect(autofill?.textContent).toContain('applicant profile reviewed and confirmed')
  })
})
