import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { executeAutofill } from './matcher/fillExecutor'
import { matchApplicationFields } from './matcher/semanticMatcher'
import type { FieldDecision, FillResult } from './matcher/types'
import { isApplicantProfile } from './review'
import { ClassicApplication, CompactApplication } from './demoLayouts'
import styles from './ControlledApplication.module.css'

type DemoLayout = 'classic' | 'compact'

const outcomeLabels: Record<FieldDecision['outcome'], string> = {
  fill: 'Will fill',
  preserve: 'Already answered',
  missing: 'Needs your detail',
  ambiguous: 'Needs your review',
  unsupported: 'Left untouched',
  sensitive: 'Left for you',
  invalid: 'Needs a valid profile value',
}

function displayField(decision: FieldDecision): string {
  const label = decision.element.labels?.[0]?.textContent?.trim()
  return label || decision.profileKey || decision.element.getAttribute('name') || 'Unrecognized field'
}

function PreviewList({ decisions }: { decisions: FieldDecision[] }) {
  return (
    <div className={styles.previewList} aria-live="polite">
      {decisions.map((decision, index) => (
        <div key={`${decision.element.id || decision.element.name}-${index}`} className={styles.previewItem}>
          <div>
            <strong>{displayField(decision)}</strong>
            <p>{decision.reason}</p>
          </div>
          <span className={`${styles.outcome} ${styles[decision.outcome]}`}>
            {outcomeLabels[decision.outcome]}
          </span>
        </div>
      ))}
    </div>
  )
}

function ResultSummary({ result }: { result: FillResult }) {
  return (
    <div className={styles.result} role="status">
      <strong>
        Filled {result.filled} fields · Preserved {result.preserved} answers · {result.needsInput} need your input
      </strong>
      <span>{result.skipped} fields were intentionally left untouched.</span>
      {result.verificationFailures > 0 && (
        <span>{result.verificationFailures} fields could not be verified after filling.</span>
      )}
    </div>
  )
}

export default function ControlledApplicationPage() {
  const location = useLocation()
  const profile = (location.state as { profile?: unknown } | null)?.profile
  const formAreaRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<DemoLayout>('classic')
  const [preview, setPreview] = useState<FieldDecision[]>([])
  const [result, setResult] = useState<FillResult | null>(null)

  if (!isApplicantProfile(profile)) {
    return (
      <div className="page">
        <section className={styles.emptyCard}>
          <h1>Prepare a profile first</h1>
          <p>Confirm your applicant profile before previewing an application.</p>
          <Link to="/application/prepare" className="btn-primary">Prepare Application</Link>
        </section>
      </div>
    )
  }

  const changeLayout = (nextLayout: DemoLayout) => {
    setLayout(nextLayout)
    setPreview([])
    setResult(null)
  }

  const createPreview = () => {
    if (formAreaRef.current) {
      setPreview(matchApplicationFields(formAreaRef.current, profile))
      setResult(null)
    }
  }

  const fillApplication = () => {
    if (formAreaRef.current) {
      const fillResult = executeAutofill(formAreaRef.current, profile)
      setResult(fillResult)
      setPreview(fillResult.decisions)
    }
  }

  return (
    <div className="page">
      <div className={styles.header}>
        <Link to="/application/prepare" className={styles.backLink}>← Profile review</Link>
        <h1>Preview Application Autofill</h1>
        <p>
          Review a realistic application before choosing whether to fill supported details. HireSense never submits an application.
        </p>
      </div>

      <div className={styles.layoutPicker}>
        <div>
          <span className={styles.sectionLabel}>Demo application layout</span>
          <p>Switch layouts to see the same matcher work from normal form semantics.</p>
        </div>
        <div className={styles.pickerButtons}>
          <button type="button" className={layout === 'classic' ? styles.activeLayout : styles.layoutButton} onClick={() => changeLayout('classic')}>Classic ATS</button>
          <button type="button" className={layout === 'compact' ? styles.activeLayout : styles.layoutButton} onClick={() => changeLayout('compact')}>Compact application</button>
        </div>
      </div>

      <div className={styles.workspace}>
        <section className={styles.applicationCard}>
          <div className={styles.cardHeading}>
            <div>
              <span className={styles.sectionLabel}>Controlled application</span>
              <h2>{layout === 'classic' ? 'Northstar Systems — Software Engineer' : 'Cedar Labs — Product Engineering Intern'}</h2>
            </div>
            <span className={styles.manualOnly}>Manual submission only</span>
          </div>
          <div ref={formAreaRef}>
            {layout === 'classic' ? <ClassicApplication /> : <CompactApplication />}
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn-outline" onClick={createPreview}>Preview Autofill</button>
            <button type="button" className="btn-primary" onClick={fillApplication}>Fill Supported Fields</button>
          </div>
          <p className={styles.safetyNote}>You can edit any answer. HireSense preserves existing answers and never clicks or submits this form.</p>
        </section>

        <aside className={styles.previewCard}>
          <span className={styles.sectionLabel}>Autofill preview</span>
          <h2>What HireSense will do</h2>
          {preview.length > 0 ? (
            <PreviewList decisions={preview} />
          ) : (
            <p className={styles.emptyPreview}>Preview the form to see every proposed fill, preserved answer, and intentionally skipped field.</p>
          )}
          {result && <ResultSummary result={result} />}
        </aside>
      </div>
    </div>
  )
}
