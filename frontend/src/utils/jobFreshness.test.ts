import { describe, expect, it } from 'vitest'
import { formatDiscoveryAge, formatPostedDate, isNewSinceVisit } from './jobFreshness'

describe('job freshness', () => {
  it('keeps source posting date separate from HireSense discovery time', () => {
    expect(formatPostedDate('2026-09-20')).toContain('Sep')
    expect(formatDiscoveryAge('2026-09-26T10:00:00Z', new Date('2026-09-26T12:00:00Z')))
      .toBe('New to HireSense 2h ago')
  })

  it('does not fabricate freshness when dates are missing', () => {
    expect(formatPostedDate(null)).toBeNull()
    expect(formatDiscoveryAge(null)).toBeNull()
  })

  it('uses first discovery, not source posting date, for new-since-last-visit', () => {
    expect(isNewSinceVisit('2026-10-19T12:14:00Z', '2026-10-19T12:00:00Z')).toBe(true)
    expect(isNewSinceVisit('2026-10-18T12:14:00Z', '2026-10-19T12:00:00Z')).toBe(false)
    expect(isNewSinceVisit(null, '2026-10-19T12:00:00Z')).toBe(false)
  })
})
