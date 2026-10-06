// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJob } from '../api/jobs'
import type { Job } from '../types'
import JobDetailPage from './JobDetailPage'

vi.mock('../api/jobs', () => ({ fetchJob: vi.fn() }))
vi.mock('../utils/resumeStorage', () => ({ getResumeAnalysis: () => null }))
vi.mock('../components/AIInterviewPanel', () => ({ default: () => <div>Interview practice</div> }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const job: Job = {
  id: 12,
  title: 'Software Engineer Intern',
  company: 'Northstar Systems',
  location: 'Dallas, TX',
  type: 'Internship',
  salary: 'Not listed',
  tags: ['TypeScript', 'React'],
  posted: '2026-10-01',
  firstSeenAt: '2026-10-02T12:00:00Z',
  source: 'greenhouse',
  badge: null,
  match: 0,
  logo: '',
  hybrid: 'Hybrid',
  fullDescription: 'Build accessible product experiences.\nWork with a collaborative engineering team.',
  applicationLink: 'https://example.com/apply',
}

let root: Root | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
})

async function renderPath(path: string) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/jobs/:id" element={<JobDetailPage />} /></Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('Job detail page', () => {
  it('shows the source description, skills, and connected application actions', async () => {
    vi.mocked(fetchJob).mockResolvedValue(job)
    await renderPath('/jobs/12')

    expect(document.body.textContent).toContain('Build accessible product experiences')
    expect(document.body.textContent).toContain('TypeScript')
    expect(document.querySelector('a[href="/application/prepare"]')?.textContent).toContain('Prepare application')
    expect(document.querySelector('a[href="https://example.com/apply"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Interview practice')
  })

  it('rejects an invalid route id without making an API request', async () => {
    await renderPath('/jobs/not-a-number')

    expect(document.body.textContent).toContain('This job link is invalid')
    expect(document.body.textContent).not.toContain('Try again')
    expect(fetchJob).not.toHaveBeenCalled()
  })
})
