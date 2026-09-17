import { API_BASE_URL } from './client'

export interface StructuredResumeEntry {
  title: string
  bullets: string[]
}

export interface ParsedResumeData {
  name: string | null
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
  parsed_data: ParsedResumeData
  analysis: ResumeAnalysis
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

  const response = await fetch(`${API_BASE_URL}/resume/upload`, {
    method: 'POST',
    body: formData,
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
