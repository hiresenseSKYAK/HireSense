// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJobs, fetchMarketInsights } from '../api/jobs'
import type { Job } from '../types'
import HomePage from './HomePage'

vi.mock('../api/jobs', () => ({ fetchJobs: vi.fn(), fetchMarketInsights: vi.fn() }))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const jobs: Job[] = [
  { id: 1, title: 'Junior Data Engineer', company: 'Zeta', location: 'Dallas, TX', type: 'Full-time', salary: 80000, tags: ['Python'], posted: '2026-09-20', firstSeenAt: '2026-09-25T10:00:00Z', badge: null, match: 0, logo: '', hybrid: 'Hybrid' },
  { id: 2, title: 'Software Engineer Intern', company: 'Alpha', location: 'Plano, TX', type: 'Internship', salary: 'Not listed', tags: ['TypeScript'], posted: '2026-09-22', firstSeenAt: '2026-09-26T10:00:00Z', badge: null, match: 0, logo: '', hybrid: 'On-site' },
]
const insights = { overview: { total_jobs: 2, remote_jobs: 0, hybrid_jobs: 1, onsite_jobs: 1 }, trending_skills: [], top_locations: [], top_companies: [] }

let root: Root | undefined

beforeEach(() => {
  vi.mocked(fetchJobs).mockResolvedValue(jobs)
  vi.mocked(fetchMarketInsights).mockResolvedValue(insights)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
})

async function renderPage() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MemoryRouter><HomePage /></MemoryRouter>)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Home job discovery', () => {
  it('searches, resets, and sorts the live feed with actionable controls', async () => {
    await renderPage()
    expect(document.querySelectorAll('article')).toHaveLength(2)

    const search = document.querySelector<HTMLInputElement>('input[placeholder^="Search"]')!
    setValue(search, 'no-such-role')
    expect(document.body.textContent).toContain('No roles match those filters')

    const reset = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Reset search'))!
    act(() => reset.click())
    expect(document.querySelectorAll('article')).toHaveLength(2)

    const select = document.querySelector<HTMLSelectElement>('select')!
    setValue(select, 'company')
    expect(document.querySelector('article')?.textContent).toContain('Alpha')
  })
})
