// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import ResumeSignalCard, { getSignalCenter } from './ResumeSignalCard'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
afterEach(() => {
  if (root) act(() => root.unmount())
  document.body.replaceChildren()
})
function render(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(node))
}

describe('ResumeSignalCard', () => {
  it('describes job volume without presenting it as match confidence', () => {
    expect(getSignalCenter(null, 0).feedLabel).toBe('0 live roles in view')
    expect(getSignalCenter(null, 1).feedLabel).toBe('1 live role in view')
    expect(getSignalCenter(null, 100).feedLabel).toBe('100 live roles in view')
  })

  it('invites an upload when there is no resume', () => {
    render(<ResumeSignalCard insights={null} jobCount={12} hasResume={false} />)
    expect(document.body.textContent).toContain('Ready to personalize')
    expect(document.body.textContent).toContain('Once uploaded')
  })

  it('shows the live signal once a resume is saved', () => {
    render(<ResumeSignalCard insights={null} jobCount={12} hasResume />)
    expect(document.body.textContent).toContain('Personalized ranking active')
    expect(document.body.textContent).toContain('12 live roles in view')
    expect(document.body.textContent).not.toContain('match confidence')
    expect(document.body.textContent).toContain('Waiting for live market data')
    expect(document.body.textContent).toContain('resume is shaping rankings')
  })

  it('uses only live insight values when they exist', () => {
    render(<ResumeSignalCard insights={{
      overview: { total_jobs: 2, remote_jobs: 1, hybrid_jobs: 1, onsite_jobs: 0 },
      trending_skills: [{ name: 'TypeScript', count: 2 }],
      top_locations: [{ city: 'Irving', count: 2 }],
      top_companies: [],
    }} jobCount={2} hasResume />)
    expect(document.body.textContent).toContain('Irving')
    expect(document.body.textContent).toContain('TypeScript')
    expect(document.body.textContent).not.toContain('Dallas')
  })
})
