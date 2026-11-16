import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchJobs, type MatchSummary } from '../api/jobs'
import { getAuthSession, logout } from '../api/auth'
import { getResumeAnalysis } from '../utils/resumeStorage'
import {
  clearAutofillProfileData,
  getAutofillReadiness,
} from '../features/autofill/readiness'
import { clearSyncedProfile, detectAutofillExtension } from '../features/autofill/extensionBridge'
import { getChromeExtensionStoreUrl } from '../config/extension'
import styles from './ProfilePage.module.css'

export default function ProfilePage() {
  const navigate = useNavigate()
  const authSession = getAuthSession()
  const savedResume = getResumeAnalysis()
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null)
  const [isLoadingMatches, setIsLoadingMatches] = useState(Boolean(savedResume))
  const [matchError, setMatchError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [extensionState, setExtensionState] = useState<'checking' | 'detected' | 'not-detected'>('checking')

  useEffect(() => {
    let cancelled = false
    void detectAutofillExtension().then(() => {
      if (!cancelled) setExtensionState('detected')
    }).catch(() => {
      if (!cancelled) setExtensionState('not-detected')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const resumeSkills = savedResume?.parsed_data.skills?.filter(Boolean) ?? []
    if (!savedResume || resumeSkills.length === 0) {
      setMatchSummary(null)
      setMatchError('')
      setIsLoadingMatches(false)
      return
    }

    let cancelled = false
    async function loadMatches() {
      try {
        setIsLoadingMatches(true)
        setMatchError('')
        const page = await fetchJobs({
          page: 1,
          pageSize: 1,
          sort: 'best-match',
          skills: resumeSkills,
        })
        if (!cancelled) setMatchSummary(page.matchSummary)
      } catch (err) {
        if (!cancelled) {
          setMatchSummary(null)
          setMatchError(err instanceof Error ? err.message : 'Could not load match scores.')
        }
      } finally {
        if (!cancelled) setIsLoadingMatches(false)
      }
    }
    void loadMatches()
    return () => { cancelled = true }
  }, [refreshKey])

  const resumeSkills = savedResume?.parsed_data.skills?.filter(Boolean) ?? []
  const autofillReadiness = getAutofillReadiness(savedResume)
  const savedOn = savedResume?.saved_at ? new Date(savedResume.saved_at).toLocaleDateString() : ''
  const bestMatch = matchSummary?.highest
  const extensionStoreUrl = getChromeExtensionStoreUrl()

  const handleLogout = async () => {
    clearAutofillProfileData()
    void clearSyncedProfile().catch(() => { /* The popup also offers explicit clearing if the extension is unavailable. */ })
    await logout(authSession?.token)
    navigate('/login')
  }

  const displayName = authSession?.user.username || 'HireSense User'
  const statusTone = autofillReadiness.status === 'ready' ? styles.statusReady : autofillReadiness.status === 'review' ? styles.statusReview : styles.statusIdle

  return (
    <div className={`page ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <div className={styles.avatar} aria-hidden="true">{displayName.charAt(0).toUpperCase() || 'H'}</div>
          <div className={styles.heroText}>
            <h1 className={styles.pageTitle}>Your profile</h1>
            <p className={styles.heroSubtitle}>{displayName}{authSession?.user.email ? ` · ${authSession.user.email}` : ''}</p>
          </div>
        </div>
        <button type="button" className={`btn-outline ${styles.logoutButton}`} onClick={() => void handleLogout()}>Log out</button>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="account-heading">
          <div className={styles.cardHeader}>
            <p className={styles.eyebrow}>Account</p>
            <h2 id="account-heading" className={styles.cardTitle}>Account details</h2>
          </div>
          <dl className={styles.details}>
            <div>
              <dt>Name</dt>
              <dd>{displayName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{authSession?.user.email || 'No active account'}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd className={styles.passwordValue} aria-label="Password hidden">••••••••</dd>
            </div>
          </dl>
          <p className={`${styles.muted} ${styles.cardFooter}`}>Your password is stored securely and stays hidden.</p>
        </section>

        <section className={`${styles.card} ${styles.wide}`} aria-labelledby="resume-heading">
          <div className={styles.cardHeaderRow}>
            <div className={styles.cardHeader}>
              <p className={styles.eyebrow}>Resume</p>
              <h2 id="resume-heading" className={styles.cardTitle}>{savedResume ? savedResume.filename : 'No resume on file'}</h2>
              {savedResume && savedOn && <p className={styles.muted}>Saved {savedOn}</p>}
            </div>
            <Link className="btn-outline" to="/resume">{savedResume ? 'Update resume' : 'Upload resume'}</Link>
          </div>
          {savedResume ? (
            <>
              {!isLoadingMatches && bestMatch !== null && bestMatch !== undefined && (
                <Link className={styles.matchBanner} to="/">
                  <span className={styles.matchScore}>{bestMatch}%</span>
                  <span>
                    <strong>{matchSummary?.strong ?? 0} strong matches, best {bestMatch}%</strong>
                    <span className={styles.matchHint}>See your matched jobs →</span>
                  </span>
                </Link>
              )}
              {isLoadingMatches && <p className={styles.muted}>Checking matches…</p>}
              {matchError && (
                <p className={styles.errorLine} role="alert">
                  Match scores are unavailable.{' '}
                  <button type="button" className={styles.textButton} onClick={() => setRefreshKey((key) => key + 1)}>Try again</button>
                </p>
              )}
              <div className={styles.skillsBlock}>
                <p className={styles.sectionLabel}>Skills{resumeSkills.length > 0 ? ` (${resumeSkills.length})` : ''}</p>
                {resumeSkills.length > 0 ? (
                  <div className={styles.skillChipWrap}>
                    {resumeSkills.map((skill) => <span key={skill} className={styles.skillChip}>{skill}</span>)}
                  </div>
                ) : (
                  <p className={styles.muted}>No skills were detected on this resume.</p>
                )}
              </div>
            </>
          ) : (
            <p className={styles.muted}>Upload a resume to start matching.</p>
          )}
        </section>

        <section className={styles.card} aria-labelledby="autofill-heading" aria-label="Autofill readiness">
          <div className={styles.cardHeader}>
            <p className={styles.eyebrow}>Autofill</p>
            <h2 id="autofill-heading" className={styles.cardTitle}>
              <span className={`${styles.statusDot} ${statusTone}`} aria-hidden="true" />
              {autofillReadiness.label}
            </h2>
          </div>
          <p className={styles.muted}>{autofillReadiness.detail}</p>
          <div className={styles.cardFooter}>
            <Link className="btn-primary" to="/application/prepare">Review autofill profile</Link>
          </div>
        </section>

        <section className={`${styles.card} ${styles.wide} ${styles.extensionCard}`} aria-labelledby="extension-heading">
          <div className={styles.cardHeader}>
            <p className={styles.eyebrow}>Browser companion</p>
            <h2 id="extension-heading" className={styles.cardTitle}>HireSense Autofill Extension</h2>
          </div>
          <p className={styles.muted}>Use your reviewed HireSense profile to preview and fill safe application fields.</p>
          <div className={styles.cardFooter}>
            {extensionState === 'checking' ? (
              <p className={styles.extensionStatus} role="status">Checking for the extension…</p>
            ) : extensionState === 'detected' ? (
              <div className={styles.extensionActions}>
                <span className={`${styles.extensionStatus} ${styles.extensionDetected}`} role="status">Extension detected</span>
                <Link className="btn-outline" to="/application/prepare">{autofillReadiness.status === 'ready' ? 'Sync profile' : 'Review profile to sync'}</Link>
              </div>
            ) : extensionStoreUrl ? (
              <div className={styles.extensionActions}>
                <a className="btn-primary" href={extensionStoreUrl} target="_blank" rel="noopener noreferrer">Install for Chrome</a>
                <span className={styles.extensionHint}>Already installed? Reload the extension and refresh this page.</span>
              </div>
            ) : (
              <p className={styles.extensionStatus} role="status">Coming soon</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
