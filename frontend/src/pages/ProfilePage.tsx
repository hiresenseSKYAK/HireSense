import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchJobs, type MatchSummary } from '../api/jobs'
import { getAuthSession, logout } from '../api/auth'
import { getResumeAnalysis } from '../utils/resumeStorage'
import {
  clearAutofillProfileConfirmation,
  getAutofillReadiness,
} from '../features/autofill/readiness'
import styles from './ProfilePage.module.css'

export default function ProfilePage() {
  const navigate = useNavigate()
  const authSession = getAuthSession()
  const savedResume = getResumeAnalysis()
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null)
  const [isLoadingMatches, setIsLoadingMatches] = useState(Boolean(savedResume))
  const [matchError, setMatchError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

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

  const handleLogout = async () => {
    clearAutofillProfileConfirmation()
    await logout(authSession?.token)
    navigate('/login')
  }

  return (
    <div className="page">
      <h1 className={styles.pageTitle}>Your profile</h1>
      <div className={styles.stack}>
        <section className={styles.card} aria-labelledby="account-heading">
          <div className={styles.accountRow}>
            <div className={styles.avatar} aria-hidden="true">{authSession?.user.username?.charAt(0).toUpperCase() || 'H'}</div>
            <div>
              <p className={styles.eyebrow}>Account</p>
              <h2 id="account-heading" className={styles.cardTitle}>Account details</h2>
            </div>
          </div>
          <dl className={styles.details}>
            <div>
              <dt>Name</dt>
              <dd>{authSession?.user.username || 'HireSense User'}</dd>
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
          <p className={styles.muted}>Your password is stored securely and stays hidden.</p>
          <button type="button" className="btn-outline" onClick={() => void handleLogout()}>Log out</button>
        </section>

        <section className={styles.card} aria-labelledby="resume-heading">
          <p className={styles.eyebrow}>Resume</p>
          <h2 id="resume-heading" className={styles.cardTitle}>{savedResume ? savedResume.filename : 'No resume on file'}</h2>
          {savedResume ? (
            <>
              {savedOn && <p className={styles.muted}>Saved {savedOn}</p>}
              {resumeSkills.length > 0 ? (
                <div className={styles.skillChipWrap}>
                  {resumeSkills.map((skill) => <span key={skill} className={styles.skillChip}>{skill}</span>)}
                </div>
              ) : (
                <p className={styles.muted}>No skills were detected on this resume.</p>
              )}
              {isLoadingMatches && <p className={styles.muted}>Checking matches…</p>}
              {!isLoadingMatches && bestMatch !== null && bestMatch !== undefined && (
                <Link className={styles.matchLink} to="/">
                  {matchSummary?.strong ?? 0} strong matches, best {bestMatch}%
                </Link>
              )}
              {matchError && (
                <p className={styles.errorLine} role="alert">
                  Match scores are unavailable.{' '}
                  <button type="button" className={styles.textButton} onClick={() => setRefreshKey((key) => key + 1)}>Try again</button>
                </p>
              )}
            </>
          ) : (
            <p className={styles.muted}>Upload a resume to start matching.</p>
          )}
          <Link className="btn-outline" to="/resume">{savedResume ? 'Update resume' : 'Upload resume'}</Link>
        </section>

        <section className={styles.card} aria-labelledby="autofill-heading" aria-label="Autofill readiness">
          <p className={styles.eyebrow}>Autofill</p>
          <h2 id="autofill-heading" className={styles.cardTitle}>{autofillReadiness.label}</h2>
          <p className={styles.muted}>{autofillReadiness.detail}</p>
          <Link className="btn-primary" to="/application/prepare">Review autofill profile</Link>
        </section>
      </div>
    </div>
  )
}
