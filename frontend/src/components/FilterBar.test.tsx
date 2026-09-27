// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import FilterBar, { buildEmptyFilters, type FilterState } from './FilterBar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Harness() {
  const [filters, setFilters] = useState<FilterState>(buildEmptyFilters())
  return <FilterBar filters={filters} onChange={setFilters} resultCount={4} cityOptions={['Dallas']} />
}

function button(label: string) {
  return Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(label))!
}

describe('FilterBar', () => {
  it('applies and clears a work-style filter', () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<Harness />))

    act(() => button('Work style').click())
    const remote = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.includes('Remote'))!
    act(() => remote.querySelector('input')?.click())
    expect(document.body.textContent).toContain('Clear all')

    act(() => button('Clear all').click())
    expect(document.body.textContent).not.toContain('Clear all')
  })
})
