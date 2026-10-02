import {
  historyDateError,
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

const textKeys = [
  'fullName', 'firstName', 'lastName', 'email', 'phone',
  'city', 'state', 'country', 'addressLine1', 'addressLine2', 'postalCode', 'linkedin', 'github', 'portfolio',
  'skills', 'school', 'degree', 'fieldOfStudy', 'educationStart', 'educationEnd',
  'company', 'jobTitle', 'workLocation', 'employmentStart', 'employmentEnd',
] as const

const educationKeys = ['school', 'degree', 'fieldOfStudy', 'startDate', 'endDate'] as const
const experienceKeys = ['company', 'title', 'location', 'startDate', 'endDate', 'description'] as const

function isEntryList(value: unknown, keys: readonly string[]): boolean {
  return Array.isArray(value) && value.every((entry) =>
    isRecord(entry)
    && keys.every((key) => typeof entry[key] === 'string')
    && typeof entry.current === 'boolean',
  )
}

export function hasApplicantValue(values: ApplicantProfile): boolean {
  const text = textKeys.some((key) => values[key].trim() !== '')
  const skills = values.skillList.some((skill) => skill.trim() !== '')
  const education = values.education.some((entry) => educationKeys.some((key) => entry[key].trim() !== ''))
  const experience = values.experience.some((entry) => experienceKeys.some((key) => entry[key].trim() !== ''))
  return text || skills || education || experience
}

export function isApplicantProfile(value: unknown): value is ApplicantProfile {
  if (!isRecord(value)) {
    return false
  }

  return textKeys.every((key) => typeof value[key] === 'string')
    && Array.isArray(value.skillList)
    && value.skillList.every((skill) => typeof skill === 'string')
    && isEntryList(value.education, educationKeys)
    && isEntryList(value.experience, experienceKeys)
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
    Object.keys(getProfileReviewErrors(state)).length === 0 &&
    historyDateError(state.values) === null
  )
}
