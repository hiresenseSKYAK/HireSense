import type { ResumeUploadResponse } from '../../api/resume'
import type { ApplicantProfile } from './core/types'
import { initializeApplicantProfile } from './core/profile'

const AUTOFILL_CONFIRMATION_KEY = 'hiresense_autofill_confirmation'

type StoredConfirmation = {
  resumeSignature: string
  confirmedAt: string
  profile: ApplicantProfile
}

export type AutofillReadiness = {
  status: 'unavailable' | 'review' | 'ready'
  label: string
  detail: string
}

function hashText(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function getResumeSignature(resume: ResumeUploadResponse) {
  return hashText(JSON.stringify({ filename: resume.filename, parsedData: resume.parsed_data }))
}

export function markAutofillProfileConfirmed(
  resume: ResumeUploadResponse,
  profile: ApplicantProfile = initializeApplicantProfile(resume),
) {
  const confirmation: StoredConfirmation = {
    resumeSignature: getResumeSignature(resume),
    confirmedAt: new Date().toISOString(),
    profile,
  }
  sessionStorage.setItem(AUTOFILL_CONFIRMATION_KEY, JSON.stringify(confirmation))
}

export function clearAutofillProfileConfirmation() {
  sessionStorage.removeItem(AUTOFILL_CONFIRMATION_KEY)
}

function getStoredConfirmation(): StoredConfirmation | null {
  const raw = sessionStorage.getItem(AUTOFILL_CONFIRMATION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredConfirmation>
    if (
      typeof parsed.resumeSignature !== 'string'
      || typeof parsed.confirmedAt !== 'string'
      || !parsed.profile
    ) {
      return null
    }
    return parsed as StoredConfirmation
  } catch {
    return null
  }
}

export function getConfirmedAutofillProfile(
  resume: ResumeUploadResponse,
): ApplicantProfile | null {
  const confirmation = getStoredConfirmation()
  if (confirmation?.resumeSignature !== getResumeSignature(resume)) return null
  return confirmation.profile
}

export function getAutofillReadiness(resume: ResumeUploadResponse | null): AutofillReadiness {
  if (!resume) {
    return {
      status: 'unavailable',
      label: '—',
      detail: 'upload a resume to prepare',
    }
  }

  const confirmation = getStoredConfirmation()
  if (confirmation?.resumeSignature === getResumeSignature(resume)) {
    return {
      status: 'ready',
      label: 'Ready',
      detail: 'applicant profile reviewed and confirmed',
    }
  }

  return {
    status: 'review',
    label: 'Review',
    detail: 'confirmation required before autofill',
  }
}
