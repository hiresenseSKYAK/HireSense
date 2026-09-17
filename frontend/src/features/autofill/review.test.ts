import { describe, expect, it } from 'vitest'
import {
  confirmProfileReview,
  initializeProfileReviewState,
  isProfileReviewConfirmed,
  updateProfileValue,
} from './core/profile'
import {
  canConfirmProfile,
  getProfileReviewErrors,
  hasApplicantValue,
  hasUsableResumeAnalysis,
} from './review'

describe('applicant profile review workflow', () => {
  const resume = {
    filename: 'candidate.pdf',
    parsed_data: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+1 555 123 4567',
    },
  }

  it('initializes supported resume values and leaves manual fields blank', () => {
    const state = initializeProfileReviewState(resume)

    expect(state.values.fullName).toBe('Ada Lovelace')
    expect(state.values.email).toBe('ada@example.com')
    expect(state.values.phone).toBe('+1 555 123 4567')
    expect(state.values.firstName).toBe('')
    expect(state.values.city).toBe('')
    expect(state.values.linkedin).toBe('')
  })

  it('recognizes missing and malformed resume state', () => {
    expect(hasUsableResumeAnalysis(null)).toBe(false)
    expect(hasUsableResumeAnalysis({})).toBe(false)
    expect(hasUsableResumeAnalysis({ parsed_data: null })).toBe(false)
    expect(hasUsableResumeAnalysis(resume)).toBe(true)
  })

  it('shows validation errors for invalid values and allows valid edits', () => {
    const invalid = updateProfileValue(
      initializeProfileReviewState(resume),
      'linkedin',
      'http://linkedin.com/in/ada',
    )

    expect(getProfileReviewErrors(invalid).linkedin).toBeDefined()

    const valid = updateProfileValue(
      invalid,
      'linkedin',
      'https://www.linkedin.com/in/ada',
    )

    expect(getProfileReviewErrors(valid)).toEqual({})
  })

  it('requires the review checkbox before confirming a valid profile', () => {
    const state = initializeProfileReviewState(resume)

    expect(canConfirmProfile(state, false)).toBe(false)
    expect(canConfirmProfile(state, true)).toBe(true)
  })

  it('cannot confirm an invalid profile', () => {
    const invalid = updateProfileValue(
      initializeProfileReviewState(resume),
      'email',
      'not-an-email',
    )

    expect(canConfirmProfile(invalid, true)).toBe(false)
  })

  it('requires at least one nonempty applicant value', () => {
    const empty = initializeProfileReviewState({ parsed_data: {} })

    expect(hasApplicantValue(empty.values)).toBe(false)
    expect(canConfirmProfile(empty, true)).toBe(false)
  })

  it('confirms only the current revision and invalidates after an edit', () => {
    const confirmed = confirmProfileReview(initializeProfileReviewState(resume))

    expect(isProfileReviewConfirmed(confirmed)).toBe(true)

    const edited = updateProfileValue(confirmed, 'city', 'London')

    expect(isProfileReviewConfirmed(edited)).toBe(false)
    expect(canConfirmProfile(edited, true)).toBe(true)

    const reconfirmed = confirmProfileReview(edited)
    expect(isProfileReviewConfirmed(reconfirmed)).toBe(true)
  })
})
