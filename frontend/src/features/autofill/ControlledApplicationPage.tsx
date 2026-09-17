import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { executeAutofillVerified } from './matcher/fillExecutor'
import { matchApplicationFields } from './matcher/semanticMatcher'
import { previewSummary, reportField } from './matcher/report'
import type { FieldDecision, FillResult } from './matcher/types'
import { isApplicantProfile } from './review'
import { ClassicApplication, CompactApplication } from './demoLayouts'
import AutofillSteps from './AutofillSteps'
import styles from './ControlledApplication.module.css'

type DemoLayout = 'classic' | 'compact'

function PreviewList({ decisions }: { decisions: FieldDecision[] }) {
  return <div className={styles.previewList}>
    {decisions.map((decision, index) => {
      const field = reportField(decision)
      return <div key={index} className={styles.previewItem}>
        <div className={styles.itemHeading}><strong>{field.label}</strong><span className={styles.outcome + ' ' + styles[field.tone]}>{field.status}</span></div>
        {field.value && <div className={styles.proposedValue}>{field.value}</div>}
        <p>{field.reason}</p>
      </div>
    })}
  </div>
}

export default function ControlledApplicationPage() {
  const location = useLocation()
  const profile = (location.state as { profile?: unknown } | null)?.profile
  const formAreaRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<DemoLayout>('classic')
  const [preview, setPreview] = useState<FieldDecision[]>([])
  const [result, setResult] = useState<FillResult | null>(null)
  const [busy, setBusy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [])
  useEffect(() => { if (result) resultRef.current?.focus() }, [result])

  if (!isApplicantProfile(profile)) {
    return <div className="page"><section className={styles.emptyCard}>
      <span className={styles.sectionLabel}>Application Autofill</span>
      <h1>Your next application starts here</h1>
      <p>Review and confirm your resume details first. Then see what HireSense can safely prepare for you.</p>
      <Link to="/application/prepare" className="btn-primary">Review my profile →</Link>
    </section></div>
  }

  const changeLayout = (next: DemoLayout) => {
    if (next === layout) return
    setLayout(next); setPreview([]); setResult(null)
  }
  const createPreview = () => {
    if (formAreaRef.current) {
      setPreview(matchApplicationFields(formAreaRef.current, profile))
      setResult(null)
    }
  }
  const fillApplication = async () => {
    if (!formAreaRef.current || !preview.length || busy || result) return
    setBusy(true)
    try {
      const next = await executeAutofillVerified(formAreaRef.current, profile, preview)
      setResult(next); setPreview(next.decisions)
    } finally { setBusy(false) }
  }
  const ready = preview.filter((d) => d.outcome === 'fill').length

  return <div className="page">
    <div className={styles.header}>
      <Link to="/application/prepare" state={{ draftProfile: profile }} className={styles.backLink}>← Review profile</Link>
      <h1 tabIndex={-1} ref={headingRef}>Prepare your next application</h1>
      <p>Your information. Your decision. Preview the proposed changes, then fill only the supported details.</p>
    </div>
    <AutofillSteps step={result ? 3 : 2} />
    <div className={styles.layoutPicker}>
      <div><span className={styles.sectionLabel}>Application examples</span><p>Two realistic layouts. The same confirmed profile. Switching resets the example.</p></div>
      <div className={styles.pickerButtons} role="group" aria-label="Application example layout">
        <button type="button" disabled={busy} aria-pressed={layout === 'classic'} className={layout === 'classic' ? styles.activeLayout : styles.layoutButton} onClick={() => changeLayout('classic')}>Classic ATS</button>
        <button type="button" disabled={busy} aria-pressed={layout === 'compact'} className={layout === 'compact' ? styles.activeLayout : styles.layoutButton} onClick={() => changeLayout('compact')}>Compact application</button>
      </div>
    </div>
    <div className={styles.workspace}>
      <section className={styles.applicationCard}>
        <div className={styles.cardHeading}>
          <div><span className={styles.sectionLabel}>Controlled example · no application is sent</span><h2>{layout === 'classic' ? 'Northstar Systems' : 'Cedar Labs'}</h2><p>{layout === 'classic' ? 'Software Engineer' : 'Product Engineering Intern'}</p></div>
          <span className={styles.manualOnly}>You stay in control</span>
        </div>
        <div ref={formAreaRef}>{layout === 'classic' ? <ClassicApplication /> : <CompactApplication />}</div>
        <p className={styles.safetyNote}>Existing answers stay yours. Eligibility, references, consent, and written responses need your attention.</p>
      </section>
      <aside className={styles.previewCard} aria-label="Autofill review">
        <span className={styles.sectionLabel}>{result ? 'Your preparation results' : 'Preview before filling'}</span>
        <h2>{result ? (result.writeFailures || result.verificationFailures || result.changed ? 'Review the remaining details' : 'Application prepared') : 'Know what will change'}</h2>
        <div role="status" aria-live="polite">
          {result ? <div ref={resultRef} tabIndex={-1} className={styles.result}>
            <strong>{result.filled} filled & verified · {result.preserved} preserved</strong>
            <span>{result.needsInput} need your attention. Review every answer before you submit.</span>
            {!!result.changed && <span>{result.changed} changed after preview.</span>}
            {!!result.writeFailures && <span>{result.writeFailures} could not be written.</span>}
            {!!result.verificationFailures && <span>{result.verificationFailures} could not be verified.</span>}
          </div> : preview.length > 0 ? <p className={styles.summary}>{previewSummary(preview)}</p> : <div className={styles.emptyPreview}>
            <div className={styles.previewIcon} aria-hidden="true">≡</div>
            <strong>A clear plan before any changes</strong>
            <p>Inspect this example to see your proposed answers and the questions left for you. Previewing changes nothing.</p>
          </div>}
        </div>
        <div className={styles.actions}>
          <button type="button" className={preview.length ? 'btn-outline' : 'btn-primary'} disabled={busy} onClick={createPreview}>{preview.length ? 'Preview again' : 'Preview autofill'}</button>
          {preview.length > 0 && !result && <button type="button" className="btn-primary" disabled={busy || ready === 0} onClick={() => void fillApplication()}>{busy ? 'Filling & checking…' : 'Fill ' + ready + (ready === 1 ? ' supported field' : ' supported fields')}</button>}
        </div>
        {preview.length > 0 && <PreviewList decisions={preview} />}
        <p className={styles.safetyNote}>HireSense never clicks Submit or advances an application.</p>
        {result && <div className={styles.nextAction}><strong>Ready for a real application?</strong><p>Use this profile with the HireSense Chrome extension on conventional application forms.</p><Link to="/application/prepare" state={{ draftProfile: profile }}>Review profile & connect extension →</Link></div>}
      </aside>
    </div>
  </div>
}
