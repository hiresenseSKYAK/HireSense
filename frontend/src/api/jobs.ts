import type { Job } from '../types'
import client, { ApiError } from './client'

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
  geo?: 'dfw' | 'remote' | 'texas' | 'nationwide'
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
  if (params.geo) search.set('geo', params.geo)
  appendAll(search, 'city', params.cities)
  appendAll(search, 'style', params.styles)
  appendAll(search, 'experience', params.experience)
  appendAll(search, 'salary', params.salaries)
  appendAll(search, 'type', params.types)
  appendAll(search, 'date', params.dates)
  appendAll(search, 'skill', params.skills)

  let body: Record<string, unknown>
  try {
    body = (await client.get<Record<string, unknown>>(`/jobs/?${search.toString()}`, {
      signal: params.signal,
      cacheTtlMs: 10_000,
    })).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      throw new Error('The live job service is temporarily unavailable. Please try again shortly.')
    }
    throw error
  }
  return {
    items: Array.isArray(body.items) ? body.items : [],
    total: Number(body.total) || 0,
    page: Number(body.page) || 1,
    pageSize: Number(body.page_size) || JOB_PAGE_SIZE,
    cities: Array.isArray(body.cities) ? body.cities : [],
    matchSummary: (body.match_summary as MatchSummary | null | undefined) ?? null,
  }
}

export async function fetchJob(jobId: number): Promise<Job> {
  try {
    return (await client.get<Job>(`/jobs/${jobId}`, { cacheTtlMs: 30_000 })).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Error('This job is no longer available.')
    }
    if (error instanceof ApiError && error.status === 503) {
      throw new Error('The live job service is temporarily unavailable. Please try again shortly.')
    }
    throw error
  }
}

export async function fetchMarketInsights(signal?: AbortSignal): Promise<MarketInsightsResponse> {
  try {
    return (await client.get<MarketInsightsResponse>('/jobs/market-insights', {
      signal,
      cacheTtlMs: 60_000,
    })).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      throw new Error('Market insights are temporarily unavailable.')
    }
    throw error
  }
}
