import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResumeUploadResponse } from '../../api/resume'
import {
  confirmProfileReview,
  initializeProfileReviewState,
  isProfileReviewConfirmed,
} from './core/profile'
import type { ApplicantProfile } from './core/types'
import {
  canConfirmProfile,
  getProfileReviewErrors,
  hasApplicantValue,
} from './review'
import {
  canUseAutofillExtension,
  sendConfirmedProfileToExtension,
} from './extensionBridge'
import styles from './ProfileReview.module.css'

interface ProfileReviewProps {
  resume: ResumeUploadResponse
  draft?: ApplicantProfile
  onContinue: (profile: ApplicantProfile) => void
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
  { name: 'state', label: 'State / Province', autoComplete: 'address-level1' },
  { name: 'country', label: 'Country of residence', autoComplete: 'country-name' },
  { name: 'addressLine1', label: 'Street address', autoComplete: 'address-line1' },
  { name: 'addressLine2', label: 'Apartment / Suite', autoComplete: 'address-line2' },
  { name: 'postalCode', label: 'ZIP / Postal code', autoComplete: 'postal-code' },
  { name: 'linkedin', label: 'LinkedIn', type: 'url', autoComplete: 'url' },
  { name: 'github', label: 'GitHub', type: 'url', autoComplete: 'url' },
  { name: 'portfolio', label: 'Portfolio', type: 'url', autoComplete: 'url' },
]

export default function ProfileReview({ resume, draft, onContinue }: ProfileReviewProps) {
  const [reviewState, setReviewState] = useState(() =>
    ({ ...initializeProfileReviewState(resume), ...(draft ? { values: { ...draft } } : {}) }),
  )
  const initialValues = useMemo(() => initializeProfileReviewState(resume).values, [resume])
  const [edited, setEdited] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState('')
  const readyRef = useRef<HTMLDivElement>(null)

  const errors = useMemo(
    () => getProfileReviewErrors(reviewState),
    [reviewState],
  )
  const isConfirmed = isProfileReviewConfirmed(reviewState)
  const canConfirm = canConfirmProfile(reviewState, hasReviewed)
  useEffect(() => { if (isConfirmed) readyRef.current?.focus() }, [isConfirmed])

  const handleChange = (field: keyof ApplicantProfile, value: string) => {
    if (isConfirmed) setEdited(true)
    setHasReviewed(false)
    setBridgeStatus('')
    // Keep spaces while typing; normalize only on blur.
    setReviewState((current) => ({
      ...current,
      values: { ...current.values, [field]: value },
      revision: current.revision + 1,
      confirmedRevision: null,
    }))
  }

  const handleConfirm = () => {
    if (canConfirm) {
      setReviewState((current) => {
        const confirmed = confirmProfileReview(current)
        return confirmed
      })
    }
  }

  const sendToBrowserBridge = async () => {
    if (!isConfirmed || sending) return
    setSending(true)
    setBridgeStatus('Sending your confirmed details…')
    try {
      await sendConfirmedProfileToExtension(reviewState.values)
      setBridgeStatus('Profile received. Open an application tab, then choose Preview in HireSense Autofill. Available for 30 minutes or until cleared.')
    } catch (error) {
      setBridgeStatus(error instanceof Error ? error.message : 'Could not send the profile to the browser bridge.')
    } finally {
      setSending(false)
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
            Only details you confirm will be used. Optional blanks stay blank; HireSense never guesses.
          </p>
        </div>
        <div className={styles.revision} role="status">
          {isConfirmed ? '✓ Profile confirmed' : !hasApplicantValue(reviewState.values) ? 'Profile incomplete' : Object.keys(errors).length ? 'Check your details' : edited ? 'Changes need confirmation' : hasReviewed ? 'Ready to confirm' : 'Ready to review'}
        </div>
      </div>

      <div className={styles.sourceResume}>
        <span className={styles.sourceLabel}>Source resume</span>
        <span className={styles.sourceFilename}>
          {reviewState.sourceFilename || 'Previously uploaded resume'}
        </span>
      </div>

      <p className={styles.fieldGuide}>Contact details & professional links <span>{Object.values(reviewState.values).filter((value) => value.trim()).length} of {fields.length} details available</span></p>
      <p className={styles.confirmationHint}>Names and address details are yours to enter. Country means where you live, never citizenship. Blank fields remain manual.</p>
      <div className={styles.fieldGrid}>
        {fields.map((field) => {
          const error = errors[field.name]
          const errorId = `${field.name}-error`

          return (
            <label key={field.name} className={styles.field} data-field={field.name}>
              <span className={styles.fieldLabel}>{field.label}<span className={styles.origin} aria-hidden="true">{!reviewState.values[field.name].trim() ? 'Optional' : initialValues[field.name] && reviewState.values[field.name].trim() === initialValues[field.name] ? 'From resume' : 'Added by you'}</span></span>
              <input
                className={`${styles.input} ${error ? styles.inputInvalid : ''}`}
                type={field.type ?? 'text'}
                autoComplete={field.autoComplete}
                value={reviewState.values[field.name]}
                onChange={(event) => handleChange(field.name, event.target.value)}
                onBlur={() => setReviewState((current) => ({ ...current, values: { ...current.values, [field.name]: current.values[field.name].trim() } }))}
                placeholder={field.type === 'url' ? 'https://' : undefined}
                disabled={sending}
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
            onChange={(event) => {
              setHasReviewed(event.target.checked)
              if (!event.target.checked) setReviewState((current) => ({ ...current, confirmedRevision: null }))
            }}
            disabled={sending}
          />
          <span>
            I reviewed the information above. Blank fields should remain unfilled.
          </span>
        </label>

        {edited && !isConfirmed && <p className={styles.confirmationHint} role="status">Your details changed. Review and confirm again before continuing. If you already sent a profile to the extension, resend it after confirming to replace that copy.</p>}
        {Object.keys(errors).length > 0 && <p className={styles.fieldError} role="status">Correct the highlighted details before confirming.</p>}
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
          {isConfirmed ? 'Profile confirmed' : 'Confirm my information'}
        </button>
      </div>

      {isConfirmed && (
        <div>
          <div ref={readyRef} tabIndex={-1} className={styles.readyState} role="status"><strong>✓ Your profile is ready.</strong> Choose where to prepare an application. You will always preview before filling.</div>
          <div className={styles.choiceGrid}>
            <section className={styles.choice}>
              <p className={styles.eyebrow}>Explore safely</p>
              <h3>Try an application example</h3>
              <p>See exactly what gets filled, what stays untouched, and what needs your attention.</p>
              <button type="button" className="btn-primary" onClick={() => onContinue(reviewState.values)}>Preview application →</button>
            </section>
            <section className={styles.choice}>
              <p className={styles.eyebrow}>Take it with you</p>
              <h3>Use on an external application</h3>
              <p>Send only these details to the HireSense extension. Your account information stays here. Choose an active resume separately inside the extension; attachments always require their own action.</p>
              <button type="button" className="btn-outline" disabled={!canUseAutofillExtension() || sending} onClick={() => void sendToBrowserBridge()}>
                {sending ? 'Sending profile…' : 'Send to extension'}
              </button>
              {!canUseAutofillExtension() && <p className={styles.confirmationHint}>Requires the HireSense Chrome extension and a configured connection. You can still try the application examples.</p>}
              {bridgeStatus && <p className={styles.bridgeStatus} role="status">{bridgeStatus}</p>}
            </section>
          </div>
        </div>
      )}
    </section>
  )
}
