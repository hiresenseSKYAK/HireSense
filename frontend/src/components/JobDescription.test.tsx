// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import JobDescription, { formatJobDescription } from './JobDescription'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

it('renders provider HTML as headings, paragraphs, and lists', () => {
  act(() => root.render(<JobDescription content="<h2>Responsibilities</h2><p>Build reliable services.</p><ul><li>Review code</li><li>Support teammates</li></ul>" />))
  expect(container.querySelector('h3')?.textContent).toBe('Responsibilities')
  expect(container.querySelector('p')?.textContent).toBe('Build reliable services.')
  expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Review code', 'Support teammates'])
})

it('structures flattened plain text at semantic headings and sentence boundaries', () => {
  const sentence = 'We build dependable software for customers and support it with careful reviews.'
  const content = `About the Role: ${Array.from({ length: 10 }, () => sentence).join(' ')} Requirements: Clear communication.`
  const blocks = formatJobDescription(content)
  expect(blocks.filter((block) => block.type === 'heading').map((block) => 'text' in block ? block.text : '')).toEqual(['About the Role', 'Requirements'])
  expect(blocks.filter((block) => block.type === 'paragraph').length).toBeGreaterThan(2)
})

it('groups bullet-heavy descriptions into a real list', () => {
  act(() => root.render(<JobDescription content="Responsibilities • Build APIs • Write tests • Review code" />))
  expect(container.querySelector('h3')?.textContent).toBe('Responsibilities')
  expect(container.querySelectorAll('ul li')).toHaveLength(3)
})

it('handles malformed provider HTML without exposing markup', () => {
  act(() => root.render(<JobDescription content="<h2>Qualifications<p>Python<li>Clear communication<li>Curiosity" />))
  expect(container.textContent).toContain('Qualifications')
  expect(container.textContent).toContain('Clear communication')
  expect(container.innerHTML).not.toContain('&lt;h2&gt;')
})

it('handles an empty description', () => {
  act(() => root.render(<JobDescription content="" />))
  expect(container.textContent).toBe('No description available.')
})

it('drops scripts, embedded content, and event-bearing elements', () => {
  act(() => root.render(<JobDescription content={'<p>Safe employer wording.</p><script>alert("x")</script><iframe>unsafe</iframe><img src=x onerror="alert(1)">' } />))
  expect(container.textContent).toBe('Safe employer wording.')
  expect(container.querySelector('script, iframe, img')).toBeNull()
  expect(container.innerHTML).not.toContain('onerror')
})
