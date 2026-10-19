import { getAuthSession } from './auth'
import { interviewResumeContext } from './interview'
import type { ParsedResumeData } from './resume'
import type { Job } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export type ResumeCoachResult = {
  strongest_evidence: string[]
  bullet_coaching: { evidence: string; issue: string; recommendation: string }[]
  repeated_phrasing: string[]
  skills_without_evidence: string[]
  summary_guidance: string[]
  source: 'ai' | 'fallback'
  cached: boolean
  degraded_reason?: string
}

export type JobPreparationResult = {
  alignment: 'Strong alignment' | 'Moderate alignment' | 'Needs preparation'
  strongest_matches: { requirement: string; resume_evidence: string }[]
  missing_requirements: string[]
  likely_interview_topics: string[]
  experiences_to_emphasize: string[]
  resume_tailoring: { evidence: string; issue: string; recommendation: string }[]
  application_talking_points: string[]
  professional_summary: string
  recruiter_screen_questions: string[]
  skill_gaps: { skill: string; status: 'demonstrated' | 'partial' | 'missing'; why_it_matters: string; next_steps: string[] }[]
  source: 'ai' | 'fallback'
  cached: boolean
  degraded_reason?: string
}

export type JobRecommendationsResult = {
  items: Job[]
  ranking_source: 'deterministic' | 'semantic_bounded'
  cached: boolean
}

async function request<T>(path: string, resume: ParsedResumeData): Promise<T> {
  const token = getAuthSession()?.token
  if (!token) throw new Error('Sign in to use personalized coaching.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 35000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ resume_data: interviewResumeContext(resume) }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { detail?: unknown }
      throw new Error(typeof body.detail === 'string' ? body.detail : 'Personalized coaching is unavailable. Try again.')
    }
    return await response.json() as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Coaching took too long. Try again.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export const getResumeCoach = (resume: ParsedResumeData) => request<ResumeCoachResult>('/ai/resume-coach', resume)
export const getJobPreparation = (jobId: number, resume: ParsedResumeData) => request<JobPreparationResult>(`/ai/jobs/${jobId}/preparation`, resume)
export const getJobRecommendations = (resume: ParsedResumeData) => request<JobRecommendationsResult>('/ai/jobs/recommendations', resume)
