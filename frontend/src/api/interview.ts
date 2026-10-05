import type { ParsedResumeData } from './resume'
import { getAuthSession } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export type InterviewQuestion = {
  session_id: number
  question_index: number
  total_questions: number
  question_id: string
  focus_area: string
  prompt: string
  tips: string[]
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
}

export type FinalInterviewResult = {
  final_score: number
  overall_summary: string
  top_strengths: string[]
  next_steps: string[]
  dimensions?: InterviewScoreDimension[]
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

export async function startInterview(jobId: number, resumeData: ParsedResumeData): Promise<InterviewQuestion> {
  const response = await fetch(`${API_BASE_URL}/interview/start`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      job_id: jobId,
      resume_data: resumeData,
    }),
  })

  if (!response.ok) {
    let errorMessage = 'Failed to start interview.'

    try {
      const errorData = await response.json()
      errorMessage = errorData.detail || errorMessage
    } catch {
      // keep fallback
    }

    throw new Error(errorMessage)
  }

  return response.json()
}

export async function submitInterviewAnswer(
  sessionId: number,
  answer: string,
): Promise<InterviewAnswerResult> {
  const response = await fetch(`${API_BASE_URL}/interview/${sessionId}/answer`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ answer }),
  })

  if (!response.ok) {
    let errorMessage = 'Failed to submit interview answer.'

    try {
      const errorData = await response.json()
      errorMessage = errorData.detail || errorMessage
    } catch {
      // keep fallback
    }

    throw new Error(errorMessage)
  }

  return response.json()
}