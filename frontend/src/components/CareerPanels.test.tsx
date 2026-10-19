// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JobPreparationPanel from './JobPreparationPanel'
import ResumeCoachPanel from './ResumeCoachPanel'
import { getJobPreparation, getResumeCoach } from '../api/career'
import type { ParsedResumeData } from '../api/resume'

vi.mock('../api/career', () => ({ getJobPreparation: vi.fn(), getResumeCoach: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const resume: ParsedResumeData = { name: null, email: null, phone: null,
  skills: ['Python'], education: [], experience: [], projects: [], leadership: [],
  experience_entries: [], project_entries: [], leadership_entries: [] }
let container: HTMLDivElement
let root: Root
beforeEach(() => { vi.resetAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label)
  expect(button).toBeDefined()
  await act(async () => button?.click())
}

describe('career coaching panels', () => {
  it('shows deterministic job preparation when AI is unavailable and supports retry', async () => {
    vi.mocked(getJobPreparation).mockResolvedValueOnce({
      alignment: 'Needs preparation', strongest_matches: [], missing_requirements: ['SQL'],
      likely_interview_topics: ['SQL'], experiences_to_emphasize: [], resume_tailoring: [],
      application_talking_points: [], professional_summary: '', recruiter_screen_questions: [],
      skill_gaps: [], source: 'fallback', cached: false,
    })
    await act(async () => root.render(<JobPreparationPanel jobId={1} resume={resume} />))
    expect(container.textContent).toContain('Prepare for this role')
    await click('Prepare for this role')
    expect(container.textContent).toContain('Standard guidance')
    expect(container.textContent).toContain('SQL')
    vi.mocked(getJobPreparation).mockRejectedValueOnce(new Error('Temporary error'))
    await click('Retry guidance')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Temporary error')
  })

  it('shows grounded resume coaching without invented metrics', async () => {
    vi.mocked(getResumeCoach).mockResolvedValueOnce({
      strongest_evidence: ['Built a Python parser.'], bullet_coaching: [{
        evidence: 'Built a Python parser.', issue: 'Outcome unclear.',
        recommendation: 'Add a real metric if you have one.',
      }], repeated_phrasing: [], skills_without_evidence: [], summary_guidance: [],
      source: 'ai', cached: false,
    })
    await act(async () => root.render(<ResumeCoachPanel resume={resume} />))
    await click('Run Resume Coach')
    expect(container.textContent).toContain('AI coaching active')
    expect(container.textContent).toContain('Add a real metric if you have one.')
  })
})
