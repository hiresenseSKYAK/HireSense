// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResumeUploadResponse } from '../../api/resume'
import {
  clearAutofillProfileConfirmation,
  clearAutofillProfileData,
  getAutofillDraft,
  getConfirmedAutofillProfile,
  getAutofillReadiness,
  markAutofillProfileConfirmed,
  saveAutofillDraft,
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

beforeEach(() => localStorage.clear())

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

  it('keeps unconfirmed edits as a draft after the confirmation is withdrawn', () => {
    const profile = { ...initializeApplicantProfile(resume), city: 'Austin', addressLine1: '1 Main St' }
    markAutofillProfileConfirmed(resume, profile)
    clearAutofillProfileConfirmation()
    const edited = { ...profile, postalCode: '78701' }
    saveAutofillDraft(resume, edited)

    expect(getConfirmedAutofillProfile(resume)).toBeNull()
    expect(getAutofillDraft(resume)).toEqual(edited)
  })

  it('carries the user\'s own edits over to a newly uploaded resume', () => {
    const edited = { ...initializeApplicantProfile(resume), city: 'Austin', phone: '5559990000' }
    saveAutofillDraft(resume, edited)
    const updatedResume = {
      ...resume,
      filename: 'resume-v2.pdf',
      parsed_data: { ...resume.parsed_data, email: 'ada@new.example.com', phone: '5551234567' },
    }

    const draft = getAutofillDraft(updatedResume)
    expect(draft?.city).toBe('Austin')
    expect(draft?.phone).toBe('5559990000')
    expect(draft?.email).toBe('ada@new.example.com')
  })

  it('clears drafts and confirmations on logout', () => {
    markAutofillProfileConfirmed(resume)
    clearAutofillProfileData()
    expect(getAutofillDraft(resume)).toBeNull()
    expect(getAutofillReadiness(resume).status).toBe('review')
  })
})
