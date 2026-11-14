// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import JobDetailPage from './JobDetailPage'
import { fetchJob } from '../api/jobs'
import { getJobSummary } from '../api/career'

vi.mock('../api/jobs', () => ({ fetchJob: vi.fn() }))
vi.mock('../api/career', () => ({ getJobSummary: vi.fn() }))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: () => null }))
vi.mock('../components/JobPreparationPanel', () => ({ default: () => <section>Prepare for role</section> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  vi.mocked(fetchJob).mockResolvedValue({ id: 1, title: 'Backend Engineer', company: 'Acme', location: 'Denton, TX', type: 'Full-time', hybrid: 'Hybrid', applicationLink: 'https://example.com/apply', skills: [] } as never)
  vi.mocked(getJobSummary).mockResolvedValue({ source: 'unavailable', reason: 'short_description' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

it('promotes a dedicated interview path without requiring an application', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/jobs/1']}><Routes><Route path="/jobs/:id" element={<JobDetailPage />} /></Routes></MemoryRouter>))
  expect(container.textContent).toContain('Practice this role with purpose')
  expect(container.querySelector('a[href="/interviews/new/1"]')).not.toBeNull()
  expect(container.querySelector('textarea')).toBeNull()
  const apply = [...container.querySelectorAll('a')].find(link => link.textContent?.includes('Apply directly'))
  expect(apply).toBeDefined()
  await act(async () => apply?.click())
  expect(container.textContent).toContain('You chose Apply directly')
  expect(container.textContent).toContain('Submission happens on the employer’s site')
  expect(container.querySelector('a[href="/interviews/new/1"]')).not.toBeNull()
})

const longDescription = 'Original posting text about the payments team. '.repeat(30)
const renderJob = () => act(async () => root.render(<MemoryRouter initialEntries={['/jobs/1']}><Routes><Route path="/jobs/:id" element={<JobDetailPage />} /></Routes></MemoryRouter>))

it('shows the AI summary first and keeps the full description one click away', async () => {
  vi.mocked(fetchJob).mockResolvedValue({ id: 1, title: 'Backend Engineer', company: 'Acme', location: 'Denton, TX', type: 'Full-time', hybrid: 'Hybrid', skills: [], fullDescription: longDescription } as never)
  vi.mocked(getJobSummary).mockResolvedValue({ source: 'ai', cached: true, overview: 'Build payment APIs.', responsibilities: ['Write Python services'], requirements: ['SQL experience'], nice_to_have: [] })
  await renderJob()
  expect(getJobSummary).toHaveBeenCalledWith(1, expect.any(AbortSignal))
  expect(container.textContent).toContain('AI summary')
  expect(container.textContent).toContain('Build payment APIs.')
  expect(container.textContent).toContain('Write Python services')
  expect(container.textContent).not.toContain('Nice to have')
  expect(container.textContent).not.toContain('Original posting text')
  const toggle = [...container.querySelectorAll('button')].find(button => button.textContent === 'Show full description')!
  await act(async () => toggle.click())
  expect(container.textContent).toContain('Original posting text')
})

it('falls back to the original description when no summary is available', async () => {
  vi.mocked(fetchJob).mockResolvedValue({ id: 1, title: 'Backend Engineer', company: 'Acme', location: 'Denton, TX', type: 'Full-time', hybrid: 'Hybrid', skills: [], fullDescription: longDescription } as never)
  await renderJob()
  expect(container.textContent).not.toContain('AI summary')
  expect(container.textContent).toContain('Original posting text')
})
