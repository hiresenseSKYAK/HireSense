import type { Job } from '../types'

function parsedDate(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatPostedDate(value?: string | null): string | null {
  const date = parsedDate(value)
  if (!date) return null
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDiscoveryAge(value?: string | null, now = new Date()): string | null {
  const date = parsedDate(value)
  if (!date) return null
  const elapsed = Math.max(0, now.getTime() - date.getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `Found by HireSense ${Math.max(1, minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Found by HireSense ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Found by HireSense ${days}d ago`
  return `Found by HireSense ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

export function sourcePostedAt(job: Pick<Job, 'datePosted' | 'posted'>): string | null {
  return job.datePosted || job.posted || null
}

export function timestampValue(value?: string | null): number {
  return parsedDate(value)?.getTime() ?? 0
}
