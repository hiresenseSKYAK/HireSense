import { API_BASE_URL } from './client'
import { getAuthSession } from './auth'

export interface StructuredResumeEntry {
  title: string
  bullets: string[]
}

export interface ParsedResumeData {
  name: string | null
  first_name?: string | null
  last_name?: string | null
  city?: string | null
  state?: string | null
  linkedin?: string | null
  github?: string | null
  email: string | null
  phone: string | null
  skills: string[]
  education: string[]
  experience: string[]
  projects: string[]
  leadership: string[]
  experience_entries: StructuredResumeEntry[]
  project_entries: StructuredResumeEntry[]
  leadership_entries: StructuredResumeEntry[]
}

export interface ResumeAnalysis {
  score: number
  summary: string
  strengths: string[]
  warnings: string[]
  improvements: string[]
}

export interface ResumeUploadResponse {
  filename: string
  saved_at?: string
  parsed_data: ParsedResumeData
  analysis: ResumeAnalysis
  /** "ai" when the OpenAI-assisted parser was used, "rules" when it fell back to the rule-based parser. */
  parser_source?: 'ai' | 'rules'
  applicant_profile?: {
    skills?: string | string[]
    education?: Array<{ school?: string; degree?: string; fieldOfStudy?: string; startDate?: string; endDate?: string; current?: boolean }>
    experience?: Array<{ company?: string; title?: string; location?: string; startDate?: string; endDate?: string; description?: string; current?: boolean }>
  }
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function validateResumeFile(file: File) {
  const fileName = file.name.toLowerCase()
  const isAllowed = fileName.endsWith('.pdf') || fileName.endsWith('.docx')

  if (!isAllowed) {
    throw new Error('Only PDF and DOCX files are allowed.')
  }

  if (file.size === 0) {
    throw new Error('The selected file is empty.')
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File is too large. Please upload a resume smaller than 5 MB.')
  }
}

export async function uploadResume(file: File): Promise<ResumeUploadResponse> {
  validateResumeFile(file)

  const formData = new FormData()
  formData.append('file', file)

  // Signed-in uploads let the backend use AI-assisted parsing (rules-only otherwise).
  const token = getAuthSession()?.token
  const response = await fetch(`${API_BASE_URL}/resume/upload`, {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  if (!response.ok) {
    let errorMessage = 'Failed to upload resume.'

    try {
      const errorData = await response.json()
      errorMessage = errorData.detail || errorMessage
    } catch {
      errorMessage = 'Server error while uploading resume.'
    }

    throw new Error(errorMessage)
  }

  return response.json()
}
