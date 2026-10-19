// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import JobDetailPage from './JobDetailPage'
import { fetchJob } from '../api/jobs'

vi.mock('../api/jobs', () => ({ fetchJob: vi.fn() }))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: () => null }))
vi.mock('../components/JobPreparationPanel', () => ({ default: () => <section>Prepare for role</section> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  vi.mocked(fetchJob).mockResolvedValue({ id: 1, title: 'Backend Engineer', company: 'Acme', location: 'Denton, TX', type: 'Full-time', hybrid: 'Hybrid', applicationLink: 'https://example.com/apply', skills: [] } as never)
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
