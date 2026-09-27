// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
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

function renderCard(showMatch = true) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <MemoryRouter><JobCard job={job} showMatch={showMatch} /></MemoryRouter>,
  ))
}

describe('JobCard', () => {
  it('shows source-backed status without inventing hiring or freshness claims', () => {
    renderCard()
    expect(document.body.textContent).toContain('LIVE')
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
})
