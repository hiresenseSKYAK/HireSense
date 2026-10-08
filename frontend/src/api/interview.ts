import type { ParsedResumeData } from './resume'
import { getAuthSession } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export type InterviewMode = 'behavioral' | 'technical' | 'mixed' | 'role_specific'
export type InterviewOptions = { mode: InterviewMode; question_count: 3 | 5 | 8 }

export type InterviewQuestion = {
  session_id: number
  question_index: number
  total_questions: number
  question_id: string
  focus_area: string
  prompt: string
  tips: string[]
  source?: 'ai' | 'fallback'
  is_follow_up?: boolean
  parent_question_id?: string | null
  mode?: InterviewMode
}

export type InterviewScoreDimension = {
  label: string
  score: number
  max_score: number
}

export type InterviewFeedback = {
  score: number
  benchmark: string
  summary: string
  strengths: string[]
  improvements: string[]
  dimensions?: InterviewScoreDimension[]
  source?: 'ai' | 'fallback'
  technical_depth?: string
  communication?: string
  role_relevance?: string
  evidence?: string[]
  suggested_approach?: string
}

export type FinalInterviewResult = {
  final_score: number
  overall_summary: string
  top_strengths: string[]
  next_steps: string[]
  dimensions?: InterviewScoreDimension[]
  source?: 'ai' | 'fallback'
  technical_signals?: string
  communication_signals?: string
  resume_evidence?: string[]
  strongest_questions?: string[]
  practice_questions?: string[]
  strongest_responses?: InterviewResponseReference[]
  weakest_responses?: InterviewResponseReference[]
  specificity_needs?: string[]
}

export type InterviewAnswerResult = {
  session_id: number
  question_index: number
  is_complete: boolean
  feedback: InterviewFeedback
  next_question: InterviewQuestion | null
  final_result: FinalInterviewResult | null
}

export type InterviewResponseReference = { question: string; answer_excerpt: string; score: number }
export type InterviewSessionState = {
  session_id: number; job_id: number; status: 'in_progress' | 'completed'; mode: InterviewMode
  total_questions: number; current_question: InterviewQuestion | null; last_response: InterviewAnswerResult | null
}
export class InterviewApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function interviewResumeContext(resume: ParsedResumeData) {
  const clean = (text: string, limit: number) => text
    .split('\n').filter(line => !/^\s*(?:name|email|phone|address|zip(?: code)?|postal code|gender|citizenship|date of birth|auth(?:orization)? token)\s*:/i.test(line)).join('\n')
    .replace(/\b\d{1,6}\s+(?:[\w.-]+\s+){1,5}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd)\b[^\n|;]*/gi, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
    .replace(/(?:\+?1[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]?\d{3}[ .-]?\d{4}\b/g, '[redacted]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, limit)
  const entries = (value: ParsedResumeData['experience_entries']) => (value ?? []).slice(0, 10).map(e => ({ title: clean(e.title, 200), bullets: e.bullets.slice(0, 8).map(b => clean(b, 1000)) }))
  return {
    skills: (resume.skills ?? []).slice(0, 50).map(s => clean(s, 100)),
    education: (resume.education ?? []).slice(0, 10).map(s => clean(s, 500)),
    experience_entries: entries(resume.experience_entries), project_entries: entries(resume.project_entries),
    leadership_entries: entries(resume.leadership_entries),
    experience: resume.experience_entries?.length ? [] : (resume.experience ?? []).slice(0, 10).map(s => clean(s, 1000)),
    projects: resume.project_entries?.length ? [] : (resume.projects ?? []).slice(0, 10).map(s => clean(s, 1000)),
    leadership: resume.leadership_entries?.length ? [] : (resume.leadership ?? []).slice(0, 10).map(s => clean(s, 1000)),
  }
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string') }
function score(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100 }
function dimensions(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(d => object(d) && typeof d.label === 'string' && score(d.score) && score(d.max_score) && Number(d.max_score) > 0 && Number(d.score) <= Number(d.max_score)))
}
function question(value: unknown): value is InterviewQuestion {
  return object(value) && Number.isInteger(value.session_id) && Number(value.session_id) > 0 &&
    Number.isInteger(value.question_index) && Number(value.question_index) > 0 && Number.isInteger(value.total_questions) &&
    Number(value.total_questions) >= Number(value.question_index) && typeof value.question_id === 'string' &&
    typeof value.prompt === 'string' && value.prompt.trim().length > 0 && typeof value.focus_area === 'string' && strings(value.tips) &&
    (value.source === undefined || value.source === 'ai' || value.source === 'fallback') &&
    (value.is_follow_up === undefined || typeof value.is_follow_up === 'boolean')
}
function optionalText(value: Record<string, unknown>, keys: string[]) { return keys.every(k => value[k] === undefined || typeof value[k] === 'string') }
function optionalLists(value: Record<string, unknown>, keys: string[]) { return keys.every(k => value[k] === undefined || strings(value[k])) }
function references(value: unknown) { return value === undefined || (Array.isArray(value) && value.every(r => object(r) && typeof r.question === 'string' && typeof r.answer_excerpt === 'string' && score(r.score))) }
function feedback(value: unknown): value is InterviewFeedback {
  return object(value) && score(value.score) && typeof value.benchmark === 'string' && typeof value.summary === 'string' &&
    strings(value.strengths) && strings(value.improvements) && dimensions(value.dimensions) &&
    optionalText(value, ['technical_depth', 'communication', 'role_relevance', 'suggested_approach']) && optionalLists(value, ['evidence'])
}
function final(value: unknown): value is FinalInterviewResult {
  return object(value) && score(value.final_score) && typeof value.overall_summary === 'string' && strings(value.top_strengths) &&
    strings(value.next_steps) && dimensions(value.dimensions) && optionalText(value, ['technical_signals', 'communication_signals']) &&
    optionalLists(value, ['resume_evidence', 'strongest_questions', 'practice_questions', 'specificity_needs']) &&
    references(value.strongest_responses) && references(value.weakest_responses)
}
function answerResult(value: unknown): value is InterviewAnswerResult {
  return object(value) && Number.isInteger(value.session_id) && Number.isInteger(value.question_index) && feedback(value.feedback) &&
    typeof value.is_complete === 'boolean' && (value.is_complete ? final(value.final_result) && value.next_question === null : question(value.next_question) && value.final_result === null)
}
function sessionState(value: unknown): value is InterviewSessionState {
  return object(value) && Number.isInteger(value.session_id) && Number.isInteger(value.job_id) &&
    ['mixed', 'technical', 'behavioral', 'role_specific'].includes(String(value.mode)) &&
    Number.isInteger(value.total_questions) && (value.last_response === null || answerResult(value.last_response)) &&
    (value.status === 'completed' ? value.current_question === null && object(value.last_response) && value.last_response.is_complete === true : value.status === 'in_progress' && question(value.current_question))
}

async function interviewRequest<T>(path: string, payload: unknown, validate: (v: unknown) => v is T): Promise<T> {
  const auth = getAuthSession()
  if (!auth?.token) throw new InterviewApiError('Sign in to start or continue an interview.', 401)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: payload === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    if (!response.ok) {
      let message = 'Unable to process the interview. Try again.'
      try {
        const error = await response.json()
        message = typeof error.detail === 'string' ? error.detail : 'Check your interview input and try again.'
      } catch { /* Keep a readable error for non-JSON failures. */ }
      throw new InterviewApiError(message, response.status)
    }
    const data: unknown = await response.json()
    if (!validate(data)) throw new InterviewApiError('The interview response was incomplete. Retry to continue safely.', 502)
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new InterviewApiError('The interview request timed out. Retry to continue.', 408)
    throw error
  } finally { clearTimeout(timeout) }
}

export async function startInterview(jobId: number, resumeData: ParsedResumeData,
  options: InterviewOptions = { mode: 'mixed', question_count: 5 }): Promise<InterviewQuestion> {
  return interviewRequest('/interview/start', { job_id: jobId, resume_data: interviewResumeContext(resumeData), ...options }, question)
}
export async function submitInterviewAnswer(sessionId: number, answer: string, questionId: string): Promise<InterviewAnswerResult> {
  return interviewRequest(`/interview/${sessionId}/answer`, { answer, question_id: questionId }, answerResult)
}
export async function getInterviewSession(sessionId: number): Promise<InterviewSessionState> {
  return interviewRequest(`/interview/${sessionId}`, undefined, sessionState)
}

export function interviewRecoveryKey(jobId: number, resume: ParsedResumeData | null): string | null {
  const owner = getAuthSession()?.user?.id
  if (!owner || !resume) return null
  // A non-secret fingerprint detects changed professional context. Store only an ID.
  let hash = 2166136261
  for (const char of JSON.stringify(interviewResumeContext(resume))) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `hiresense_interview_v2:${owner}:${jobId}:${hash >>> 0}`
}
