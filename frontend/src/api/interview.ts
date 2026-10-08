import type { ParsedResumeData } from './resume'
import { getAuthSession } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export type InterviewMode = 'behavioral' | 'technical' | 'mixed' | 'role_specific'
export type InterviewOptions = { mode: InterviewMode; question_count: 3 | 5 | 8 }

export type InterviewQuestion = {
  session_id: number
  session_token?: string | null
  question_index: number
  total_questions: number
  question_id: string
  focus_area: string
  prompt: string
  tips: string[]
  source?: 'ai' | 'fallback'
  is_follow_up?: boolean
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
}

export type InterviewAnswerResult = {
  session_id: number
  question_index: number
  is_complete: boolean
  feedback: InterviewFeedback
  next_question: InterviewQuestion | null
  final_result: FinalInterviewResult | null
}

function buildHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const session = getAuthSession()
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`
  }

  return headers
}

async function interviewRequest<T>(path: string, payload: unknown, sessionToken?: string | null): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { ...buildHeaders(), ...(sessionToken ? { 'X-Interview-Token': sessionToken } : {}) },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      let message = 'Unable to process the interview. Try again.'
      try {
        const error = await response.json()
        message = typeof error.detail === 'string' ? error.detail : 'Check your interview input and try again.'
      } catch { /* Keep the readable fallback for non-JSON errors. */ }
      throw new Error(message)
    }
    return await response.json()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The interview request timed out. Retry to continue.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function startInterview(
  jobId: number,
  resumeData: ParsedResumeData,
  options: InterviewOptions = { mode: 'mixed', question_count: 5 },
): Promise<InterviewQuestion> {
  return interviewRequest('/interview/start', { job_id: jobId, resume_data: resumeData, ...options })
}

export async function submitInterviewAnswer(
  sessionId: number,
  answer: string,
  questionId: string,
  sessionToken?: string | null,
): Promise<InterviewAnswerResult> {
  return interviewRequest(`/interview/${sessionId}/answer`, { answer, question_id: questionId }, sessionToken)
}
