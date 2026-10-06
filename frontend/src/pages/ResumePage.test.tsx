// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadResume, type ResumeUploadResponse } from '../api/resume'
import { getResumeAnalysis, saveResumeAnalysis } from '../utils/resumeStorage'
import ResumePage from './ResumePage'

vi.mock('../api/resume', () => ({ uploadResume: vi.fn() }))
vi.mock('../utils/resumeStorage', () => ({
  getResumeAnalysis: vi.fn(),
  saveResumeAnalysis: vi.fn(),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const savedResume: ResumeUploadResponse = {
  filename: 'current-resume.pdf',
  saved_at: '2026-10-05T18:00:00Z',
  parsed_data: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '555-123-4567',
    skills: ['Python'],
    education: ['University of Texas'],
    experience: [],
    projects: [],
    leadership: [],
    experience_entries: [],
    project_entries: [],
    leadership_entries: [],
  },
  analysis: {
    score: 72,
    summary: 'Evidence found in the current resume.',
    strengths: ['Contact information is present.'],
    warnings: [],
    improvements: [],
  },
}

let root: Root | undefined

beforeEach(() => {
  vi.mocked(getResumeAnalysis).mockReturnValue(savedResume)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
})

async function renderPage() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MemoryRouter><ResumePage /></MemoryRouter>)
    await Promise.resolve()
  })
}

describe('Resume page', () => {
  it('keeps the saved resume when a replacement upload fails', async () => {
    vi.mocked(uploadResume).mockRejectedValue(new Error('The replacement could not be processed.'))
    await renderPage()

    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    const replacement = new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' })
    Object.defineProperty(input, 'files', { configurable: true, value: [replacement] })

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('current-resume.pdf')
    expect(document.body.textContent).toContain('Ada Lovelace')
    expect(document.body.textContent).toContain('Your previously saved resume is still available')
    expect(saveResumeAnalysis).not.toHaveBeenCalled()
  })

  it('labels the heuristic as resume evidence and exposes the file control name', async () => {
    await renderPage()

    expect(document.body.textContent).toContain('Resume Evidence Score')
    expect(document.querySelector('input[aria-label="Choose a PDF or DOCX resume"]')).toBeTruthy()
  })
})
