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
  it('scales match confidence with the number of live roles', () => {
    expect(getSignalCenter(null, 0).confidence).toBe('Building signal')
    expect(getSignalCenter(null, 3).confidence).toBe('Emerging match signal')
    expect(getSignalCenter(null, 25).confidence).toBe('Strong match signal')
    expect(getSignalCenter(null, 100).confidence).toBe('High match confidence')
  })

  it('invites an upload when there is no resume', () => {
    render(<ResumeSignalCard insights={null} jobCount={12} hasResume={false} />)
    expect(document.body.textContent).toContain('Ready to personalize')
    expect(document.body.textContent).toContain('Once uploaded')
  })

  it('shows the live signal once a resume is saved', () => {
    render(<ResumeSignalCard insights={null} jobCount={12} hasResume />)
    expect(document.body.textContent).toContain('Emerging match signal')
    expect(document.body.textContent).toContain('Dallas, Plano')
    expect(document.body.textContent).toContain('actively shaping match rankings')
  })
})
