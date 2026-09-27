// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResumeUploadResponse } from '../../api/resume'
import {
  clearAutofillProfileConfirmation,
  getConfirmedAutofillProfile,
  getAutofillReadiness,
  markAutofillProfileConfirmed,
} from './readiness'
import { initializeApplicantProfile } from './core/profile'

const resume: ResumeUploadResponse = {
  filename: 'resume.pdf',
  parsed_data: {
    name: 'Ada Lovelace', email: 'ada@example.com', phone: '5551234567',
    skills: ['Python'], education: [], experience: [], projects: [], leadership: [],
    experience_entries: [], project_entries: [], leadership_entries: [],
  },
  analysis: { score: 80, summary: 'Strong foundation.', strengths: [], warnings: [], improvements: [] },
}

beforeEach(() => sessionStorage.clear())

describe('autofill readiness', () => {
  it('requires review until the current resume profile is confirmed', () => {
    expect(getAutofillReadiness(resume).status).toBe('review')
    markAutofillProfileConfirmed(resume)
    expect(getAutofillReadiness(resume).status).toBe('ready')
  })

  it('invalidates readiness when the resume or review state changes', () => {
    markAutofillProfileConfirmed(resume)
    expect(getAutofillReadiness({ ...resume, filename: 'updated-resume.pdf' }).status).toBe('review')
    clearAutofillProfileConfirmation()
    expect(getAutofillReadiness(resume).status).toBe('review')
  })

  it('restores the exact profile that was reviewed and confirmed', () => {
    const profile = { ...initializeApplicantProfile(resume), city: 'Dallas', state: 'TX' }
    markAutofillProfileConfirmed(resume, profile)

    expect(getConfirmedAutofillProfile(resume)).toEqual(profile)
  })
})
