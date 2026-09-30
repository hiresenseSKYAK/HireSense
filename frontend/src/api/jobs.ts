import type { Job } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export type MarketInsightsResponse = {
  overview: {
    total_jobs: number
    remote_jobs: number
    hybrid_jobs: number
    onsite_jobs: number
  }
  trending_skills: { name: string; count: number }[]
  top_locations: { city: string; count: number }[]
  top_companies: { name: string; count: number }[]
}

export const JOB_PAGE_SIZE = 20

export type MatchSummary = {
  strong: number
  average: number | null
  highest: number | null
  scored: number
}

export type JobsPage = {
  items: Job[]
  total: number
  page: number
  pageSize: number
  cities: string[]
  matchSummary: MatchSummary | null
}

export type JobListParams = {
  page?: number
  pageSize?: number
  query?: string
  sort?: string
  cities?: string[]
  styles?: string[]
  experience?: string[]
  salaries?: string[]
  types?: string[]
  dates?: string[]
  skills?: string[]
  signal?: AbortSignal
}

function appendAll(params: URLSearchParams, key: string, values?: string[]) {
  for (const value of values ?? []) {
    if (value) params.append(key, value)
  }
}

export async function fetchJobs(params: JobListParams = {}): Promise<JobsPage> {
  const search = new URLSearchParams()
  search.set('page', String(params.page ?? 1))
  search.set('page_size', String(params.pageSize ?? JOB_PAGE_SIZE))
  if (params.query?.trim()) search.set('q', params.query.trim())
  if (params.sort) search.set('sort', params.sort)
  appendAll(search, 'city', params.cities)
  appendAll(search, 'style', params.styles)
  appendAll(search, 'experience', params.experience)
  appendAll(search, 'salary', params.salaries)
  appendAll(search, 'type', params.types)
  appendAll(search, 'date', params.dates)
  appendAll(search, 'skill', params.skills)

  const response = await fetch(`${API_BASE_URL}/jobs/?${search.toString()}`, { signal: params.signal })

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('The live job service is temporarily unavailable. Please try again shortly.')
    }
    throw new Error('Failed to fetch jobs.')
  }

  const body = await response.json()
  return {
    items: Array.isArray(body.items) ? body.items : [],
    total: Number(body.total) || 0,
    page: Number(body.page) || 1,
    pageSize: Number(body.page_size) || JOB_PAGE_SIZE,
    cities: Array.isArray(body.cities) ? body.cities : [],
    matchSummary: body.match_summary ?? null,
  }
}

export async function fetchJob(jobId: number): Promise<Job> {
  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`)

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('This job is no longer available.')
    }
    if (response.status === 503) {
      throw new Error('The live job service is temporarily unavailable. Please try again shortly.')
    }
    throw new Error('Failed to fetch job details.')
  }

  return response.json()
}

export async function fetchMarketInsights(): Promise<MarketInsightsResponse> {
  const response = await fetch(`${API_BASE_URL}/jobs/market-insights`)

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('Market insights are temporarily unavailable.')
    }
    throw new Error('Failed to fetch market insights.')
  }

  return response.json()
}
