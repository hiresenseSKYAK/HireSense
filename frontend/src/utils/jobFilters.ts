import type { Job } from '../types'
import { sourcePostedAt } from './jobFreshness'

export const SALARY_FILTER_OPTIONS = [
  'Under $30k',
  '$30k – $60k',
  '$60k – $90k',
  '$90k – $120k',
  '$120k – $150k',
  '$150k – $180k',
  '$180k – $210k',
  '$210k+',
] as const

export const DATE_FILTER_OPTIONS = [
  'Last 24 hours',
  'Last 7 days',
  'Last 30 days',
] as const

const SALARY_BUCKETS: Record<string, { min: number; max: number | null }> = {
  'Under $30k': { min: 0, max: 30_000 },
  '$30k – $60k': { min: 30_000, max: 60_000 },
  '$60k – $90k': { min: 60_000, max: 90_000 },
  '$90k – $120k': { min: 90_000, max: 120_000 },
  '$120k – $150k': { min: 120_000, max: 150_000 },
  '$150k – $180k': { min: 150_000, max: 180_000 },
  '$180k – $210k': { min: 180_000, max: 210_000 },
  '$210k+': { min: 210_000, max: null },
}

const DATE_WINDOWS_DAYS: Record<string, number> = {
  'Last 7 days': 7,
  'Last 30 days': 30,
}

const SKIP_CITIES = new Set(['unknown', 'unknown location', 'n/a', 'na', 'none'])

export function extractCity(location?: string | null): string | null {
  if (!location) return null

  const city = location.split(',')[0]?.trim()
  if (!city) return null
  if (SKIP_CITIES.has(city.toLowerCase())) return null

  return city
}

export function uniqueCitiesFromJobs(jobs: Pick<Job, 'location'>[]): string[] {
  const byLower = new Map<string, string>()

  for (const job of jobs) {
    const city = extractCity(job.location)
    if (!city) continue

    const key = city.toLowerCase()
    if (!byLower.has(key)) {
      byLower.set(key, city)
    }
  }

  return [...byLower.values()].sort((a, b) => a.localeCompare(b))
}

function looksHourly(value: string): boolean {
  const lower = value.toLowerCase()

  return (
    lower.includes('/hr') ||
    lower.includes('/hour') ||
    lower.includes('per hour') ||
    lower.includes('hourly') ||
    /\bhr\b/.test(lower)
  )
}

function parseSalaryToken(raw: string): number | null {
  const match = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kK])?/)
  if (!match) return null

  const amount = Number(match[1])
  if (Number.isNaN(amount)) return null

  return match[2] ? amount * 1000 : amount
}

function toAnnual(amount: number, hourly: boolean): number {
  if (hourly && amount < 1000) {
    return Math.round(amount * 2080)
  }

  return amount
}

export function parseAnnualSalaryRange(
  value?: string | number | null
): { min: number; max: number } | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    const annual = toAnnual(value, false)
    return { min: annual, max: annual }
  }

  const text = String(value).trim()
  if (!text || /^not listed$/i.test(text)) return null

  const tokens = text.match(/\d[\d,]*(?:\.\d+)?\s*[kK]?/g) || []
  const amounts = tokens
    .map(parseSalaryToken)
    .filter((amount): amount is number => amount !== null && amount > 0)

  if (amounts.length === 0) return null

  const hourly = looksHourly(text)
  const annuals = amounts.map((amount) => toAnnual(amount, hourly)).sort((a, b) => a - b)

  return { min: annuals[0], max: annuals[annuals.length - 1] }
}

function rangesOverlap(
  jobMin: number,
  jobMax: number,
  bucketMin: number,
  bucketMax: number | null
): boolean {
  const bucketHi = bucketMax ?? Number.POSITIVE_INFINITY
  return jobMin < bucketHi && jobMax >= bucketMin
}

export function jobMatchesSalary(job: Job, selected: Set<string>): boolean {
  if (selected.size === 0) return true

  const salary = parseAnnualSalaryRange(job.salaryRange ?? job.salary)
  if (!salary) return false

  for (const label of selected) {
    const bucket = SALARY_BUCKETS[label]
    if (bucket && rangesOverlap(salary.min, salary.max, bucket.min, bucket.max)) {
      return true
    }
  }

  return false
}

function parsePostedDate(posted?: string | null): Date | null {
  if (!posted) return null

  const text = posted.trim()
  if (!text || /^recently posted$/i.test(text)) return null

  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) {
    const date = new Date(`${iso[1]}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const now = new Date()
  const lower = text.toLowerCase()

  if (lower.includes('just now') || lower.includes('today')) {
    return now
  }

  if (lower.includes('yesterday')) {
    const date = new Date(now)
    date.setDate(date.getDate() - 1)
    return date
  }

  const relative = lower.match(/(\d+)\s+(hour|day|week|month)s?\s+ago/)
  if (!relative) return null

  const amount = Number(relative[1])
  const unit = relative[2]
  const date = new Date(now)

  if (unit === 'hour') {
    date.setHours(date.getHours() - amount)
  } else if (unit === 'day') {
    date.setDate(date.getDate() - amount)
  } else if (unit === 'week') {
    date.setDate(date.getDate() - amount * 7)
  } else {
    date.setDate(date.getDate() - amount * 30)
  }

  return date
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function jobMatchesDatePosted(job: Job, selected: Set<string>): boolean {
  if (selected.size === 0) return true

  const posted = parsePostedDate(sourcePostedAt(job))
  if (!posted) return false

  const now = new Date()
  const daysAgo = Math.round(
    (startOfDay(now).getTime() - startOfDay(posted).getTime()) / 86_400_000
  )
  const hoursAgo = (now.getTime() - posted.getTime()) / 3_600_000

  if (daysAgo < 0) return false

  for (const label of selected) {
    if (label === 'Last 24 hours') {
      if (daysAgo === 0 || hoursAgo <= 24) return true
      continue
    }

    const window = DATE_WINDOWS_DAYS[label]
    if (window !== undefined && daysAgo <= window) {
      return true
    }
  }

  return false
}

export function jobMatchesCity(job: Job, selected: Set<string>): boolean {
  if (selected.size === 0) return true

  const city = extractCity(job.location)
  if (!city) return false

  const lower = city.toLowerCase()
  for (const value of selected) {
    if (value.toLowerCase() === lower) return true
  }

  return false
}
