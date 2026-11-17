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

const isEmptyValue = (value: unknown) =>
  typeof value === 'string' ? value.trim() === '' : Array.isArray(value) ? value.length === 0 : !value

/**
 * Applies a new resume to a draft. The resume wins for every field it fills. Values the
 * user entered or edited are kept only where the new resume leaves the field blank
 * (street address, ZIP code, a name the parser missed, and so on).
 */
function rebaseOnResume(profile: ApplicantProfile, baseline: ApplicantProfile, resume: ResumeUploadResponse): ApplicantProfile {
  const fresh = initializeApplicantProfile(resume)
  const merged: ApplicantProfile = { ...fresh }
  const record = merged as unknown as Record<string, unknown>
  for (const key of Object.keys(profile) as Array<keyof ApplicantProfile>) {
    const userEdited = !sameValue(profile[key], baseline[key])
    if (userEdited && isEmptyValue(fresh[key]) && !isEmptyValue(profile[key])) record[key] = profile[key]
  }
  return mirrorPrimaryEntries(merged)
}

function getStoredDraft(): StoredDraft | null {
  const stored = readJson(AUTOFILL_DRAFT_KEY)
  if (!stored || typeof stored.resumeSignature !== 'string' || !isApplicantProfile(stored.profile)) return null
  return {
    resumeSignature: stored.resumeSignature,
    savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : '',
    profile: stored.profile,
    // Drafts without a baseline treat every value as the user's own.
    baseline: isApplicantProfile(stored.baseline) ? stored.baseline : initializeApplicantProfile({}),
  }
}

/**
 * Returns the user's saved edits for this resume. If the resume changed since the draft
 * was saved, the new resume's values win and the user's edits fill only what it leaves blank.
 */
export function getAutofillDraft(resume: ResumeUploadResponse): ApplicantProfile | null {
  const stored = getStoredDraft()
  if (!stored) return null
  if (stored.resumeSignature === getResumeSignature(resume)) return stored.profile
  return rebaseOnResume(stored.profile, stored.baseline, resume)
}

/**
 * Call after the user uploads a resume, even the same file again. The upload's values
 * replace earlier edits; edits the resume has no value for are kept. The earlier
 * confirmation is withdrawn, because the profile changed and needs another review.
 */
export function applyUploadedResumeToAutofill(resume: ResumeUploadResponse) {
  const stored = getStoredDraft()
  removeKey(AUTOFILL_CONFIRMATION_KEY)
  if (!stored) return
  const draft: StoredDraft = {
    resumeSignature: getResumeSignature(resume),
    savedAt: new Date().toISOString(),
    profile: rebaseOnResume(stored.profile, stored.baseline, resume),
    baseline: initializeApplicantProfile(resume),
  }
  writeJson(AUTOFILL_DRAFT_KEY, draft)
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
