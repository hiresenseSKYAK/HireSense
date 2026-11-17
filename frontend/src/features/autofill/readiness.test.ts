// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResumeUploadResponse } from '../../api/resume'
import {
  applyUploadedResumeToAutofill,
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

  it('lets a new resume override edits it has values for and keeps the rest', () => {
    const edited = { ...initializeApplicantProfile(resume), city: 'Austin', phone: '5559990000', firstName: 'Typed' }
    saveAutofillDraft(resume, edited)
    const updatedResume = {
      ...resume,
      filename: 'resume-v2.pdf',
      parsed_data: { ...resume.parsed_data, email: 'ada@new.example.com', phone: '5551234567' },
    }

    const draft = getAutofillDraft(updatedResume)
    expect(draft?.phone).toBe('5551234567')
    expect(draft?.firstName).toBe('Ada')
    expect(draft?.email).toBe('ada@new.example.com')
    expect(draft?.city).toBe('Austin')
  })

  it('applies an upload of the same resume file over typed values and withdraws confirmation', () => {
    const edited = { ...initializeApplicantProfile(resume), firstName: 'Typed', postalCode: '78701' }
    markAutofillProfileConfirmed(resume, edited)

    applyUploadedResumeToAutofill(resume)

    expect(getConfirmedAutofillProfile(resume)).toBeNull()
    const draft = getAutofillDraft(resume)
    expect(draft?.firstName).toBe('Ada')
    expect(draft?.postalCode).toBe('78701')
  })

  it('keeps user-entered values through later uploads that still leave them blank', () => {
    saveAutofillDraft(resume, { ...initializeApplicantProfile(resume), addressLine1: '1 Main St' })
    applyUploadedResumeToAutofill({ ...resume, filename: 'v2.pdf' })
    applyUploadedResumeToAutofill({ ...resume, filename: 'v3.pdf' })

    expect(getAutofillDraft({ ...resume, filename: 'v3.pdf' })?.addressLine1).toBe('1 Main St')
  })

  it('clears drafts and confirmations on logout', () => {
    markAutofillProfileConfirmed(resume)
    clearAutofillProfileData()
    expect(getAutofillDraft(resume)).toBeNull()
    expect(getAutofillReadiness(resume).status).toBe('review')
  })
})
