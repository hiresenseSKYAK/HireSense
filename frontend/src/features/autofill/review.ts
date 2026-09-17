import {
  validateApplicantProfile,
  type ProfileValidationErrors,
} from './core/profile'
import type { ApplicantProfile, ProfileReviewState } from './core/types'
import type { ResumeUploadResponse } from '../../api/resume'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasUsableResumeAnalysis(
  value: unknown,
): value is ResumeUploadResponse {
  return isRecord(value) && isRecord(value.parsed_data)
}

export function hasApplicantValue(values: ApplicantProfile): boolean {
  return Object.values(values).some((value) => value.trim() !== '')
}

export function isApplicantProfile(value: unknown): value is ApplicantProfile {
  if (!isRecord(value)) {
    return false
  }

  const keys: Array<keyof ApplicantProfile> = [
    'fullName', 'firstName', 'lastName', 'email', 'phone',
    'city', 'state', 'country', 'addressLine1', 'addressLine2', 'postalCode', 'linkedin', 'github', 'portfolio',
  ]
  return keys.every((key) => typeof value[key] === 'string')
}

export function getProfileReviewErrors(
  state: ProfileReviewState,
): ProfileValidationErrors {
  return validateApplicantProfile(state.values)
}

export function canConfirmProfile(
  state: ProfileReviewState,
  hasReviewed: boolean,
): boolean {
  return (
    hasReviewed &&
    hasApplicantValue(state.values) &&
    Object.keys(getProfileReviewErrors(state)).length === 0
  )
}
