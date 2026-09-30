// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJobs, fetchMarketInsights } from '../api/jobs'
import type { Job } from '../types'
import HomePage from './HomePage'

vi.mock('../api/jobs', () => ({ fetchJobs: vi.fn(), fetchMarketInsights: vi.fn(), JOB_PAGE_SIZE: 20 }))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const jobs: Job[] = [
  { id: 1, title: 'Junior Data Engineer', company: 'Zeta', location: 'Dallas, TX', type: 'Full-time', salary: 80000, tags: ['Python'], posted: '2026-09-20', firstSeenAt: '2026-09-25T10:00:00Z', badge: null, match: 0, logo: '', hybrid: 'Hybrid' },
  { id: 2, title: 'Software Engineer Intern', company: 'Alpha', location: 'Plano, TX', type: 'Internship', salary: 'Not listed', tags: ['TypeScript'], posted: '2026-09-22', firstSeenAt: '2026-09-26T10:00:00Z', badge: null, match: 0, logo: '', hybrid: 'On-site' },
]
const insights = { overview: { total_jobs: 2, remote_jobs: 0, hybrid_jobs: 1, onsite_jobs: 1 }, trending_skills: [], top_locations: [], top_companies: [] }

function pageOf(items: Job[], extra: { total?: number; page?: number } = {}) {
  return {
    items,
    total: extra.total ?? items.length,
    page: extra.page ?? 1,
    pageSize: 20,
    cities: ['Dallas', 'Plano'],
    matchSummary: null,
  }
}

let root: Root | undefined

beforeEach(() => {
  vi.mocked(fetchJobs).mockImplementation(async (params) => {
    if (params?.query === 'no-such-role') return pageOf([])
    if (params?.page === 2) return pageOf([jobs[1]], { total: 25, page: 2 })
    const items = params?.sort === 'company' ? [jobs[1], jobs[0]] : jobs
    return pageOf(items, { total: params?.pageSize === 20 && params.sort === 'company' ? items.length : 25 })
  })
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

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('Home job discovery', () => {
  it('searches, resets, and sorts the live feed with actionable controls', async () => {
    await renderPage()
    expect(document.querySelectorAll('article')).toHaveLength(2)
    expect(document.body.textContent).toContain('Showing 1–20 of 25')

    const search = document.querySelector<HTMLInputElement>('input[placeholder^="Search"]')!
    setValue(search, 'no-such-role')
    await settle(350)
    expect(document.body.textContent).toContain('No roles match those filters')

    const reset = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Reset search'))!
    act(() => reset.click())
    await settle()
    expect(document.querySelectorAll('article')).toHaveLength(2)

    const select = document.querySelector<HTMLSelectElement>('select')!
    setValue(select, 'company')
    await settle()
    expect(document.querySelector('article')?.textContent).toContain('Alpha')
  })

  it('requests the next page instead of rendering the whole feed', async () => {
    await renderPage()
    const pageTwo = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '2')
    expect(pageTwo).toBeTruthy()
    act(() => pageTwo?.click())
    await settle()
    expect(vi.mocked(fetchJobs).mock.calls.some(([params]) => params?.page === 2)).toBe(true)
    expect(document.querySelectorAll('article')).toHaveLength(1)
    expect(document.body.textContent).toContain('Software Engineer Intern')
    expect(document.body.textContent).toContain('Showing 21–25 of 25')
  })
})
