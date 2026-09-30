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
  fetchJobs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, cities: [], matchSummary: null })),
  fetchMarketInsights: vi.fn(async () => ({
    overview: { total_jobs: 0, remote_jobs: 0, hybrid_jobs: 0, onsite_jobs: 0 },
    trending_skills: [], top_locations: [], top_companies: [],
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

describe('Profile autofill readiness', () => {
  it('shows Review until the applicant profile has been confirmed', async () => {
    await renderProfile()
    const summary = document.querySelector('[aria-label="Career readiness summary"]')
    expect(summary?.textContent).toContain('Review')
    expect(summary?.textContent).toContain('confirmation required before autofill')
  })

  it('shows Ready only for a confirmed profile tied to the current resume', async () => {
    markAutofillProfileConfirmed(resume)
    await renderProfile()
    const summary = document.querySelector('[aria-label="Career readiness summary"]')
    expect(summary?.textContent).toContain('Ready')
    expect(summary?.textContent).toContain('applicant profile reviewed and confirmed')
  })
})
