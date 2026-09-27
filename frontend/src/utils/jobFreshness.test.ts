import { describe, expect, it } from 'vitest'
import { formatDiscoveryAge, formatPostedDate } from './jobFreshness'

describe('job freshness', () => {
  it('keeps source posting date separate from HireSense discovery time', () => {
    expect(formatPostedDate('2026-09-20')).toContain('Sep')
    expect(formatDiscoveryAge('2026-09-26T10:00:00Z', new Date('2026-09-26T12:00:00Z')))
      .toBe('Found by HireSense 2h ago')
  })

  it('does not fabricate freshness when dates are missing', () => {
    expect(formatPostedDate(null)).toBeNull()
    expect(formatDiscoveryAge(null)).toBeNull()
  })
})
