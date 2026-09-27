// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Job } from '../types'
import JobCard from './JobCard'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const job: Job = {
  id: 7,
  title: 'Software Engineer Intern',
  company: 'Example Systems',
  location: 'Dallas, TX',
  type: 'Internship',
  salary: 60000,
  tags: ['TypeScript', 'React'],
  posted: '2026-09-20',
  firstSeenAt: '2026-09-26T10:00:00Z',
  source: 'greenhouse',
  badge: 'Live',
  match: 96,
  logo: '',
  hybrid: 'Hybrid',
  experienceLevel: 'Internship',
}

let root: Root | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function renderCard(showMatch = true, value: Job = job) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <MemoryRouter><JobCard job={value} showMatch={showMatch} /></MemoryRouter>,
  ))
}

describe('JobCard', () => {
  it('shows truthful source and dates without inventing hiring or freshness claims', () => {
    renderCard()
    expect(document.body.textContent).toContain('Greenhouse')
    expect(document.body.textContent).toContain('Posted')
    expect(document.body.textContent).toContain('Found by HireSense')
    expect(document.body.textContent).not.toContain('LIVE')
    expect(document.body.textContent).not.toContain('Hiring Now')
    expect(document.body.textContent).not.toContain('New Listing')
  })

  it('shows the employer as a primary identity and uses its initial fallback', () => {
    renderCard(false)
    expect(document.body.textContent).toContain('Example Systems')
    expect(document.body.textContent).toContain('Software Engineer Intern')
    expect(document.querySelector('img[alt="Example Systems logo"]')).toBeNull()
    expect(document.body.textContent).not.toContain('% match')
  })

  it('falls back to the company initial when a source logo fails', () => {
    renderCard(false, { ...job, companyLogoUrl: 'https://example.com/broken.png' })
    const image = document.querySelector('img[alt="Example Systems logo"]')
    expect(image).not.toBeNull()
    act(() => image?.dispatchEvent(new Event('error')))
    expect(document.querySelector('img[alt="Example Systems logo"]')).toBeNull()
    expect(document.body.textContent).toContain('E')
  })

  it('opens the job from the keyboard', () => {
    const container = document.createElement('div')
    document.body.replaceChildren(container)
    root = createRoot(container)
    act(() => root?.render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<JobCard job={job} />} />
          <Route path="/jobs/:id" element={<div>Job detail destination</div>} />
        </Routes>
      </MemoryRouter>,
    ))
    const card = document.querySelector<HTMLElement>('article')!
    act(() => card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(document.body.textContent).toContain('Job detail destination')
  })
})
