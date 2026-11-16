import type { ResumeUploadResponse } from '../../api/resume'
import type { ApplicantProfile } from './core/types'
import { initializeApplicantProfile, mirrorPrimaryEntries } from './core/profile'
import { isApplicantProfile } from './review'

const AUTOFILL_CONFIRMATION_KEY = 'hiresense_autofill_confirmation'
const AUTOFILL_DRAFT_KEY = 'hiresense_autofill_draft'

type StoredConfirmation = {
  resumeSignature: string
  confirmedAt: string
  profile: ApplicantProfile
}

type StoredDraft = {
  resumeSignature: string
  savedAt: string
  profile: ApplicantProfile
  // What the resume parser produced when this draft was saved, so a later resume
  // upload can tell which values the user typed and which came from the old resume.
  baseline: ApplicantProfile
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

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* Storage may be full or blocked; the page still works without persistence. */ }
}

function removeKey(key: string) {
  try { localStorage.removeItem(key) } catch { /* Storage may be blocked. */ }
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
  writeJson(AUTOFILL_CONFIRMATION_KEY, confirmation)
  saveAutofillDraft(resume, profile)
}

/** Withdraws the confirmation only. The user's edits stay saved as a draft. */
export function clearAutofillProfileConfirmation() {
  removeKey(AUTOFILL_CONFIRMATION_KEY)
}

/** Removes every saved autofill detail, for logout. */
export function clearAutofillProfileData() {
  removeKey(AUTOFILL_CONFIRMATION_KEY)
  removeKey(AUTOFILL_DRAFT_KEY)
}

function getStoredConfirmation(): StoredConfirmation | null {
  const parsed = readJson(AUTOFILL_CONFIRMATION_KEY)
  if (
    !parsed
    || typeof parsed.resumeSignature !== 'string'
    || typeof parsed.confirmedAt !== 'string'
    || !isApplicantProfile(parsed.profile)
  ) {
    return null
  }
  return parsed as StoredConfirmation
}

export function getConfirmedAutofillProfile(
  resume: ResumeUploadResponse,
): ApplicantProfile | null {
  const confirmation = getStoredConfirmation()
  if (confirmation?.resumeSignature !== getResumeSignature(resume)) return null
  return confirmation.profile
}

export function saveAutofillDraft(resume: ResumeUploadResponse, profile: ApplicantProfile) {
  const signature = getResumeSignature(resume)
  const existing = readJson(AUTOFILL_DRAFT_KEY)
  // Keep the baseline from when the draft was first made for this resume.
  const baseline = existing?.resumeSignature === signature && isApplicantProfile(existing.baseline)
    ? existing.baseline
    : initializeApplicantProfile(resume)
  const draft: StoredDraft = { resumeSignature: signature, savedAt: new Date().toISOString(), profile, baseline }
  writeJson(AUTOFILL_DRAFT_KEY, draft)
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Returns the user's saved edits for this resume. If the resume changed since the
 * draft was saved, values the user entered or edited are carried over and
 * everything else comes from the new resume.
 */
export function getAutofillDraft(resume: ResumeUploadResponse): ApplicantProfile | null {
  const stored = readJson(AUTOFILL_DRAFT_KEY)
  if (!stored || !isApplicantProfile(stored.profile)) return null
  const profile = stored.profile
  if (stored.resumeSignature === getResumeSignature(resume)) return profile
  if (!isApplicantProfile(stored.baseline)) return null

  const baseline = stored.baseline
  const merged: ApplicantProfile = { ...initializeApplicantProfile(resume) }
  const record = merged as unknown as Record<string, unknown>
  for (const key of Object.keys(profile) as Array<keyof ApplicantProfile>) {
    if (!sameValue(profile[key], baseline[key])) record[key] = profile[key]
  }
  return mirrorPrimaryEntries(merged)
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
