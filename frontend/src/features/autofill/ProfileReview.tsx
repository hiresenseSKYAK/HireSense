import { useMemo, useState } from 'react'
import type { ResumeUploadResponse } from '../../api/resume'
import {
  confirmProfileReview,
  initializeProfileReviewState,
  isProfileReviewConfirmed,
  updateProfileValue,
} from './core/profile'
import type { ApplicantProfile } from './core/types'
import {
  canConfirmProfile,
  getProfileReviewErrors,
  hasApplicantValue,
} from './review'
import styles from './ProfileReview.module.css'

interface ProfileReviewProps {
  resume: ResumeUploadResponse
}

const fields: Array<{
  name: keyof ApplicantProfile
  label: string
  type?: 'email' | 'tel' | 'url' | 'text'
  autoComplete?: string
}> = [
  { name: 'fullName', label: 'Full name', autoComplete: 'name' },
  { name: 'firstName', label: 'First name', autoComplete: 'given-name' },
  { name: 'lastName', label: 'Last name', autoComplete: 'family-name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { name: 'city', label: 'City', autoComplete: 'address-level2' },
  { name: 'state', label: 'State', autoComplete: 'address-level1' },
  { name: 'linkedin', label: 'LinkedIn', type: 'url', autoComplete: 'url' },
  { name: 'github', label: 'GitHub', type: 'url', autoComplete: 'url' },
  { name: 'portfolio', label: 'Portfolio', type: 'url', autoComplete: 'url' },
]

export default function ProfileReview({ resume }: ProfileReviewProps) {
  const [reviewState, setReviewState] = useState(() =>
    initializeProfileReviewState(resume),
  )
  const [hasReviewed, setHasReviewed] = useState(false)

  const errors = useMemo(
    () => getProfileReviewErrors(reviewState),
    [reviewState],
  )
  const isConfirmed = isProfileReviewConfirmed(reviewState)
  const canConfirm = canConfirmProfile(reviewState, hasReviewed)

  const handleChange = (field: keyof ApplicantProfile, value: string) => {
    setReviewState((current) => updateProfileValue(current, field, value))
  }

  const handleConfirm = () => {
    if (canConfirm) {
      setReviewState((current) => confirmProfileReview(current))
    }
  }

  return (
    <section className={styles.card} aria-labelledby="profile-review-title">
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.eyebrow}>Applicant profile</p>
          <h2 id="profile-review-title" className={styles.title}>
            Review your application details
          </h2>
          <p className={styles.description}>
            Confirm the information that HireSense can use in a future autofill step.
          </p>
        </div>
        <div className={styles.revision} aria-label={`Profile revision ${reviewState.revision}`}>
          Revision {reviewState.revision + 1}
        </div>
      </div>

      <div className={styles.sourceResume}>
        <span className={styles.sourceLabel}>Source resume</span>
        <span className={styles.sourceFilename}>
          {reviewState.sourceFilename || 'Previously uploaded resume'}
        </span>
      </div>

      <div className={styles.fieldGrid}>
        {fields.map((field) => {
          const error = errors[field.name]
          const errorId = `${field.name}-error`

          return (
            <label key={field.name} className={styles.field}>
              <span className={styles.fieldLabel}>{field.label}</span>
              <input
                className={`${styles.input} ${error ? styles.inputInvalid : ''}`}
                type={field.type ?? 'text'}
                autoComplete={field.autoComplete}
                value={reviewState.values[field.name]}
                onChange={(event) => handleChange(field.name, event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
              />
              {error && (
                <span id={errorId} className={styles.fieldError}>
                  {error}
                </span>
              )}
            </label>
          )
        })}
      </div>

      <div className={styles.confirmationPanel}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={hasReviewed}
            onChange={(event) => setHasReviewed(event.target.checked)}
          />
          <span>
            I reviewed the information above. Blank fields should remain unfilled.
          </span>
        </label>

        {!hasApplicantValue(reviewState.values) && (
          <p className={styles.confirmationHint}>
            Add at least one applicant detail before confirming this profile.
          </p>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={handleConfirm}
          disabled={!canConfirm || isConfirmed}
        >
          {isConfirmed ? 'Profile Confirmed' : 'Use This Profile'}
        </button>
      </div>

      {isConfirmed && (
        <div className={styles.readyState} role="status">
          <strong>Profile ready.</strong> Application autofill setup is ready for the next step.
        </div>
      )}
    </section>
  )
}
