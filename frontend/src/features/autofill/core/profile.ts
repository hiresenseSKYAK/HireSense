import type { ResumeUploadResponse } from '../../../api/resume'
import type { ApplicantProfile, ProfileReviewState } from './types'

export type ProfileValidationErrors = Partial<
  Record<keyof ApplicantProfile, string>
>

const EMPTY_PROFILE: ApplicantProfile = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  linkedin: '',
  github: '',
  portfolio: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parsedResumeData(source: unknown): Record<string, unknown> {
  if (!isRecord(source) || !isRecord(source.parsed_data)) {
    return {}
  }

  return source.parsed_data
}

export function initializeApplicantProfile(
  source: ResumeUploadResponse,
): ApplicantProfile
export function initializeApplicantProfile(source: unknown): ApplicantProfile
export function initializeApplicantProfile(source: unknown): ApplicantProfile {
  const parsedData = parsedResumeData(source)

  return {
    ...EMPTY_PROFILE,
    fullName: trimmedString(parsedData.name),
    email: trimmedString(parsedData.email),
    phone: trimmedString(parsedData.phone),
  }
}

export function initializeProfileReviewState(
  source: ResumeUploadResponse,
): ProfileReviewState
export function initializeProfileReviewState(source: unknown): ProfileReviewState
export function initializeProfileReviewState(
  source: unknown,
): ProfileReviewState {
  const sourceFilename = isRecord(source)
    ? trimmedString(source.filename)
    : ''

  return {
    values: initializeApplicantProfile(source),
    revision: 0,
    confirmedRevision: null,
    sourceFilename,
  }
}

export function isValidEmail(value: string): boolean {
  const email = value.trim()
  return email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isValidPhone(value: string): boolean {
  const phone = value.trim()
  if (phone === '') {
    return true
  }

  if (!/^\+?[0-9().\-\s]+$/.test(phone)) {
    return false
  }

  const openingParentheses = (phone.match(/\(/g) ?? []).length
  const closingParentheses = (phone.match(/\)/g) ?? []).length
  if (openingParentheses !== closingParentheses) {
    return false
  }

  const digitCount = (phone.match(/\d/g) ?? []).length
  return digitCount >= 7 && digitCount <= 15
}

function parseHttpsUrl(value: string): URL | null {
  const candidate = value.trim()
  if (candidate === '') {
    return null
  }

  try {
    const url = new URL(candidate)
    if (
      url.protocol !== 'https:' ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null
    }

    return url
  } catch {
    return null
  }
}

function hasSupportedHost(url: URL, host: string): boolean {
  return url.hostname === host || url.hostname === `www.${host}`
}

function hasSinglePathSegment(url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean)
  return segments.length === 1
}

export function isValidLinkedInUrl(value: string): boolean {
  if (value.trim() === '') {
    return true
  }

  const url = parseHttpsUrl(value)
  if (!url || !hasSupportedHost(url, 'linkedin.com')) {
    return false
  }

  const segments = url.pathname.split('/').filter(Boolean)
  return segments.length === 2 && segments[0].toLowerCase() === 'in'
}

export function isValidGitHubUrl(value: string): boolean {
  if (value.trim() === '') {
    return true
  }

  const url = parseHttpsUrl(value)
  return Boolean(
    url && hasSupportedHost(url, 'github.com') && hasSinglePathSegment(url),
  )
}

export function isValidPortfolioUrl(value: string): boolean {
  return value.trim() === '' || parseHttpsUrl(value) !== null
}

export function validateApplicantProfile(
  profile: ApplicantProfile,
): ProfileValidationErrors {
  const errors: ProfileValidationErrors = {}

  if (!isValidEmail(profile.email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (!isValidPhone(profile.phone)) {
    errors.phone = 'Enter a valid phone number.'
  }
  if (!isValidLinkedInUrl(profile.linkedin)) {
    errors.linkedin = 'Enter a valid LinkedIn HTTPS profile URL.'
  }
  if (!isValidGitHubUrl(profile.github)) {
    errors.github = 'Enter a valid GitHub HTTPS profile URL.'
  }
  if (!isValidPortfolioUrl(profile.portfolio)) {
    errors.portfolio = 'Enter a valid portfolio HTTPS URL.'
  }

  return errors
}

export function updateProfileValue<K extends keyof ApplicantProfile>(
  state: ProfileReviewState,
  field: K,
  value: ApplicantProfile[K],
): ProfileReviewState {
  const normalizedValue = value.trim()
  if (state.values[field] === normalizedValue) {
    return state
  }

  return {
    ...state,
    values: {
      ...state.values,
      [field]: normalizedValue,
    },
    revision: state.revision + 1,
    confirmedRevision: null,
  }
}

export function confirmProfileReview(
  state: ProfileReviewState,
): ProfileReviewState {
  return {
    ...state,
    confirmedRevision: state.revision,
  }
}

export function isProfileReviewConfirmed(state: ProfileReviewState): boolean {
  return state.confirmedRevision === state.revision
}
