import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResumeUploadResponse } from '../../api/resume'
import {
  confirmProfileReview,
  initializeProfileReviewState,
  isProfileReviewConfirmed,
} from './core/profile'
import { emptyEducationEntry, emptyExperienceEntry, historyDateError, LEGACY_MAX_PROFILE_ENTRIES, LEGACY_MAX_SKILLS, MAX_PROFILE_ENTRIES, MAX_SKILLS, mirrorPrimaryEntries, resumeSkillCount } from './core/profile'
import SkillTagInput from './SkillTagInput'
import type { ApplicantProfile, EducationEntry, ExperienceEntry } from './core/types'
import {
  canConfirmProfile,
  getProfileReviewErrors,
  hasApplicantValue,
} from './review'
import {
  detectAutofillExtension,
  clearSyncedProfile,
  ExtensionBridgeError,
  onAutofillExtensionReady,
  sendConfirmedProfileToExtension,
} from './extensionBridge'
import styles from './ProfileReview.module.css'
import {
  clearAutofillProfileConfirmation,
  getConfirmedAutofillProfile,
  markAutofillProfileConfirmed,
} from './readiness'
import { getChromeExtensionStoreUrl } from '../../config/extension'

interface ProfileReviewProps {
  resume: ResumeUploadResponse
  draft?: ApplicantProfile
}

type StringKey<T> = Extract<{
  [K in keyof T]-?: T[K] extends string ? K : never
}[keyof T], string>

type HistoryRow = EducationEntry | ExperienceEntry

function stringFieldValue<T>(row: T, key: StringKey<T>): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function HistoryEditor<T extends HistoryRow>({
  title,
  note,
  currentLabel,
  rows,
  columns,
  longField,
  disabled,
  onChange,
  onAdd,
  canAdd,
}: {
  title: string
  note: string
  currentLabel: string
  rows: T[]
  columns: Array<readonly [StringKey<T>, string]>
  longField?: readonly [StringKey<T>, string]
  disabled: boolean
  onChange: (rows: T[]) => void
  onAdd: () => void
  canAdd: boolean
}) {
  const updateText = (index: number, key: StringKey<T>, value: string) => {
    onChange(rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      return typeof row[key] === 'string' ? Object.assign({}, row, { [key]: value }) : row
    }))
  }

  const updateCurrent = (index: number, current: boolean) => {
    onChange(rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      return Object.assign({}, row, { current, endDate: current ? '' : row.endDate })
    }))
  }

  return (
    <section className={styles.historySection}>
      <p className={styles.fieldGuide}>{title}</p>
      <p className={styles.confirmationHint}>{note}</p>
      {rows.map((row, index) => (
        <div key={`${title}-${index}`} className={styles.entryCard}>
          <div className={styles.entryGrid}>
            {columns.map(([key, label]) => {
              const isDate = key === 'startDate' || key === 'endDate'
              return (
                <label key={key} className={styles.field}>
                  <span className={styles.fieldLabel}>{label}</span>
                  <input
                    className={styles.input}
                    type={isDate ? 'date' : 'text'}
                    value={stringFieldValue(row, key)}
                    disabled={disabled || (key === 'endDate' && row.current === true)}
                    onChange={(event) => updateText(index, key, event.target.value)}
                  />
                </label>
              )
            })}
          </div>
          <label className={styles.currentToggle}>
            <input type="checkbox" checked={row.current === true} disabled={disabled} onChange={(event) => updateCurrent(index, event.target.checked)} />
            <span>{currentLabel}</span>
          </label>
          {longField && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{longField[1]}</span>
              <textarea className={styles.input} rows={3} value={stringFieldValue(row, longField[0])} disabled={disabled} onChange={(event) => updateText(index, longField[0], event.target.value)} />
            </label>
          )}
          {rows.length > 1 && (
            <button type="button" className={styles.exampleLink} disabled={disabled} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {canAdd && (
        <button type="button" className="btn-outline" disabled={disabled} onClick={onAdd}>
          Add {title === 'Education' ? 'school' : 'job'}
        </button>
      )}
    </section>
  )
}

type StringProfileKey = StringKey<ApplicantProfile>

const fields: Array<{
  name: StringProfileKey
  label: string
  type?: 'email' | 'tel' | 'url' | 'text'
  autoComplete?: string
}> = [
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

export default function ProfileReview({ resume, draft }: ProfileReviewProps) {
  const extensionStoreUrl = getChromeExtensionStoreUrl()
  const [reviewState, setReviewState] = useState(() => {
    const initial = initializeProfileReviewState(resume)
    if (draft) return { ...initial, values: { ...draft } }
    const confirmedProfile = getConfirmedAutofillProfile(resume)
    return confirmedProfile
      ? { ...initial, values: { ...confirmedProfile }, confirmedRevision: initial.revision }
      : initial
  })
  const initialValues = useMemo(() => initializeProfileReviewState(resume).values, [resume])
  const totalResumeSkills = useMemo(() => resumeSkillCount(resume), [resume])
  const [edited, setEdited] = useState(false)
  const [sending, setSending] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState('')
  const [extensionState, setExtensionState] = useState<'checking' | 'available' | 'unavailable'>('checking')
  const readyRef = useRef<HTMLDivElement>(null)

  const errors = useMemo(
    () => getProfileReviewErrors(reviewState),
    [reviewState],
  )
  const isConfirmed = isProfileReviewConfirmed(reviewState)
  const canConfirm = canConfirmProfile(reviewState, hasReviewed) && !revoking
  useEffect(() => { if (isConfirmed) readyRef.current?.focus() }, [isConfirmed])
  useEffect(() => {
    if (!isConfirmed) return
    let cancelled = false
    const detect = () => detectAutofillExtension().then(() => {
      if (!cancelled) setExtensionState('available')
    }).catch((error: unknown) => {
      if (!cancelled) {
        setExtensionState('unavailable')
        setBridgeStatus(error instanceof Error ? error.message : 'HireSense Autofill is unavailable.')
      }
    })
    setExtensionState('checking')
    void detect()
    const stopListening = onAutofillExtensionReady(() => { if (!cancelled) void detect() })
    return () => { cancelled = true; stopListening() }
  }, [isConfirmed])

  const replaceProfile = (values: ApplicantProfile) => {
    setBridgeStatus('')
    if (isConfirmed) {
      setRevoking(true)
      void clearSyncedProfile().catch(() => {
        setBridgeStatus('Your earlier extension copy may still be present. Clear it in the popup before filling, then confirm and resend your changes.')
      }).finally(() => setRevoking(false))
    }
    clearAutofillProfileConfirmation()
    if (isConfirmed) setEdited(true)
    setHasReviewed(false)
    setReviewState((current) => ({
      ...current,
      values: mirrorPrimaryEntries(values),
      revision: current.revision + 1,
      confirmedRevision: null,
    }))
  }

  const handleChange = (field: StringProfileKey, value: string) => {
    // Keep spaces while typing; normalize only on blur.
    replaceProfile({ ...reviewState.values, [field]: value })
  }

  const handleConfirm = () => {
    if (!canConfirm) return
    const values = mirrorPrimaryEntries({
      ...reviewState.values,
      skillList: reviewState.values.skillList.map((skill) => skill.trim()).filter(Boolean),
    })
    const confirmed = confirmProfileReview({ ...reviewState, values })
    setReviewState(confirmed)
    markAutofillProfileConfirmed(resume, confirmed.values)
  }

  const sendToBrowserBridge = async () => {
    if (!isConfirmed || sending) return
    setSending(true)
    setBridgeStatus('Sending your confirmed details…')
    try {
      const result = await sendConfirmedProfileToExtension(reviewState.values)
      setExtensionState('available')
      const synced = `Profile synced ${new Date(result.syncedAt).toLocaleString()}. Open an application tab, then choose Preview in HireSense Autofill.`
      setBridgeStatus(result.limitedForOlderExtension
        ? `${synced} Your extension is an older version, so only your first ${LEGACY_MAX_SKILLS} skills and first ${LEGACY_MAX_PROFILE_ENTRIES} schools and jobs were sent. Update HireSense Autofill to send everything.`
        : synced)
    } catch (error) {
      const connectionFailure = error instanceof ExtensionBridgeError &&
        ['extension_not_installed', 'content_script_missing', 'bridge_timeout', 'protocol_mismatch'].includes(error.code)
      setExtensionState(connectionFailure ? 'unavailable' : 'available')
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

      <p className={styles.fieldGuide}>Contact details & professional links <span>{fields.filter((field) => reviewState.values[field.name].trim()).length} of {fields.length} details available</span></p>
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

      <section className={styles.historySection}>
        <p className={styles.fieldGuide}>Skills</p>
        <p className={styles.confirmationHint}>Press Enter or type a comma after each skill. An application with one skills box receives them together.</p>
        {totalResumeSkills > MAX_SKILLS && (
          <p className={styles.confirmationHint} role="status">
            Your resume lists {totalResumeSkills} skills. The first {MAX_SKILLS} are included; remove some to make room for others.
          </p>
        )}
        <SkillTagInput
          skills={reviewState.values.skillList.map((skill) => skill.trim()).filter(Boolean)}
          max={MAX_SKILLS}
          disabled={sending}
          onChange={(skillList) => replaceProfile({ ...reviewState.values, skillList })}
        />
      </section>

      <HistoryEditor
        title="Education"
        note="The first school is the one filled on an application."
        currentLabel="Currently attending"
        rows={reviewState.values.education.length > 0 ? reviewState.values.education : [emptyEducationEntry()]}
        columns={[
          ['school', 'School'],
          ['degree', 'Degree'],
          ['fieldOfStudy', 'Field of study'],
          ['startDate', 'Start'],
          ['endDate', 'End'],
        ]}
        disabled={sending}
        onChange={(education) => replaceProfile({ ...reviewState.values, education })}
        onAdd={() => replaceProfile({
          ...reviewState.values,
          education: [...(reviewState.values.education.length > 0 ? reviewState.values.education : [emptyEducationEntry()]), emptyEducationEntry()],
        })}
        canAdd={(reviewState.values.education.length > 0 ? reviewState.values.education.length : 1) < MAX_PROFILE_ENTRIES}
      />

      <HistoryEditor
        title="Work experience"
        note="The first job is the one filled on an application."
        currentLabel="Currently working here"
        rows={reviewState.values.experience.length > 0 ? reviewState.values.experience : [emptyExperienceEntry()]}
        columns={[
          ['company', 'Company'],
          ['title', 'Job title'],
          ['location', 'Location'],
          ['startDate', 'Start'],
          ['endDate', 'End'],
        ]}
        longField={['description', 'Description']}
        disabled={sending}
        onChange={(experience) => replaceProfile({ ...reviewState.values, experience })}
        onAdd={() => replaceProfile({
          ...reviewState.values,
          experience: [...(reviewState.values.experience.length > 0 ? reviewState.values.experience : [emptyExperienceEntry()]), emptyExperienceEntry()],
        })}
        canAdd={(reviewState.values.experience.length > 0 ? reviewState.values.experience.length : 1) < MAX_PROFILE_ENTRIES}
      />

      <div className={styles.confirmationPanel}>
        <label className={styles.checkboxLabel}>
          <input
            id="profile-review-confirm"
            type="checkbox"
            checked={hasReviewed}
            onChange={(event) => {
              setHasReviewed(event.target.checked)
              if (!event.target.checked) {
                if (isConfirmed) {
                  setRevoking(true)
                  void clearSyncedProfile().catch(() => {
                    setBridgeStatus('Clear the earlier extension copy in its popup before filling.')
                  }).finally(() => setRevoking(false))
                }
                clearAutofillProfileConfirmation()
                setReviewState((current) => ({ ...current, confirmedRevision: null }))
              }
            }}
            disabled={sending}
          />
          <span>
            I reviewed the information above. Blank fields should remain unfilled.
          </span>
        </label>

        {edited && !isConfirmed && <p className={styles.confirmationHint} role="status">Your details changed. Review and confirm again before continuing. If you already sent a profile to the extension, resend it after confirming to replace that copy.</p>}
        {!isConfirmed && bridgeStatus && <p className={styles.fieldError} role="alert">{bridgeStatus}</p>}
        {Object.keys(errors).length > 0 && <p className={styles.fieldError} role="status">Correct the highlighted details before confirming.</p>}
        {historyDateError(reviewState.values) && <p className={styles.fieldError} role="status">{historyDateError(reviewState.values)}</p>}
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
        <div ref={readyRef} tabIndex={-1} className={styles.readyState} role="status">
          <strong>Your profile is ready.</strong>
          <p>Send your reviewed details to the extension, then choose Preview in HireSense Autofill on an application page. They expire after 24 hours and can be cleared in the popup. Original resume files and sign-in credentials are not transferred.</p>
          <p className={styles.confirmationHint} role="status">Extension: {extensionState === 'checking' ? 'checking…' : extensionState === 'available' ? 'detected' : 'not detected or unavailable'}</p>
          <button type="button" className="btn-primary" disabled={sending || extensionState === 'checking'} onClick={() => void sendToBrowserBridge()}>
            {sending ? 'Sending profile…' : extensionState === 'unavailable' ? 'Retry extension connection' : 'Send to extension'}
          </button>
          {extensionState === 'unavailable' && (
            <p className={styles.confirmationHint}>
              {extensionStoreUrl ? <>
                Install or reload the{' '}
                <a href={extensionStoreUrl} target="_blank" rel="noopener noreferrer">HireSense Chrome extension</a>
              </> : 'Install or reload the HireSense Chrome extension'}, then refresh this page and retry. Your confirmed profile remains here.
            </p>
          )}
          {bridgeStatus && <p className={styles.bridgeStatus} role="status">{bridgeStatus}</p>}
        </div>
      )}
    </section>
  )
}
