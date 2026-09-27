import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBriefcase, IconClock, IconMap } from '../components/Icons'
import { fetchJobs, fetchMarketInsights, type MarketInsightsResponse } from '../api/jobs'
import { getAuthSession, logout } from '../api/auth'
import { getResumeAnalysis } from '../utils/resumeStorage'
import { matchResumeToJob } from '../utils/jobMatcher'
import type { Job } from '../types'
import styles from './ProfilePage.module.css'
import {
  clearAutofillProfileConfirmation,
  getAutofillReadiness,
} from '../features/autofill/readiness'

function formatPosted(value?: string) {
  return value?.trim() || 'Recently posted'
}

function countValues(values: Array<unknown>) {
  return values.filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const authSession = getAuthSession()
  const savedResume = getResumeAnalysis()
  const [jobs, setJobs] = useState<Job[]>([])
  const [insights, setInsights] = useState<MarketInsightsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    async function loadProfileData() {
      try {
        setIsLoading(true)
        setError('')
        const [jobsData, insightsData] = await Promise.all([fetchJobs(), fetchMarketInsights()])
        setJobs(jobsData)
        setInsights(insightsData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your career dashboard.')
      } finally {
        setIsLoading(false)
      }
    }
    void loadProfileData()
  }, [refreshKey])

  const rankedJobs = useMemo(() => jobs
    .map((job) => ({ ...job, matchDetails: matchResumeToJob(savedResume?.parsed_data, job) }))
    .map((job) => ({ ...job, match: job.matchDetails.matchScore }))
    .sort((a, b) => b.match - a.match), [jobs, savedResume])

  const topMatches = rankedJobs.slice(0, 4)
  const scores = savedResume ? rankedJobs.map((job) => job.match) : []
  const strongMatches = scores.filter((score) => score >= 70).length
  const averageMatch = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
  const highestMatch = scores.length ? Math.max(...scores) : null
  const resumeSkills = savedResume?.parsed_data.skills?.slice(0, 8) ?? []
  const parsed = savedResume?.parsed_data
  const completionSignals = savedResume ? countValues([
    savedResume, parsed?.name, parsed?.email, parsed?.phone, parsed?.skills,
    parsed?.education, parsed?.experience,
  ]) : 0
  const profileCompletion = Math.round((completionSignals / 7) * 100)
  const autofillReadiness = getAutofillReadiness(savedResume)

  const skillGaps = useMemo(() => {
    if (!savedResume) return []
    const counts = new Map<string, number>()
    rankedJobs.slice(0, 8).forEach((job) => {
      job.matchDetails?.missingSkills.forEach((skill) => counts.set(skill, (counts.get(skill) ?? 0) + 1))
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [rankedJobs, savedResume])

  const openJob = (jobId: number) => navigate(`/jobs/${jobId}`)
  const handleLogout = async () => {
    clearAutofillProfileConfirmation()
    await logout(authSession?.token)
    navigate('/login')
  }

  return (
    <div className="page">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Career command center</p>
          <h1>Turn your profile into a stronger search.</h1>
          <p>See what is ready, where you match, and the most useful next action—using only your resume and the live feed.</p>
        </div>
        <span className={`${styles.statusPill} ${savedResume ? styles.statusReady : ''}`}>
          <span aria-hidden="true" /> {savedResume ? 'Matching active' : 'Resume needed'}
        </span>
      </header>

      <div className={styles.layout}>
        <aside className={styles.leftRail}>
          <section className={styles.accountCard}>
            <div className={styles.avatar}>{authSession?.user.username?.charAt(0).toUpperCase() || 'H'}</div>
            <p className={styles.cardEyebrow}>Your account</p>
            <h2 className={styles.accountName}>{authSession?.user.username || 'HireSense User'}</h2>
            <p className={styles.accountEmail}>{authSession?.user.email || 'No active account'}</p>
            <div className={styles.accountDivider} />
            <div className={styles.completionHeader}><span>Profile completion</span><strong>{profileCompletion}%</strong></div>
            <div className={styles.progressTrack} aria-label={`Profile ${profileCompletion}% complete`}><span style={{ width: `${profileCompletion}%` }} /></div>
            <p className={styles.helperText}>{savedResume ? savedResume.filename : 'Upload a resume to begin matching.'}</p>
            <button type="button" className="btn-outline" onClick={() => void handleLogout()}>Log out</button>
          </section>

          <section className={styles.sideCard}>
            <p className={styles.cardEyebrow}>Quick actions</p>
            <div className={styles.actionList}>
              <button type="button" onClick={() => navigate('/resume')}><strong>{savedResume ? 'Update resume' : 'Upload resume'}</strong><span>Refresh your analysis and match signal</span></button>
              <button type="button" onClick={() => navigate('/application/prepare')}><strong>Review autofill profile</strong><span>{autofillReadiness.detail}</span></button>
              <button type="button" onClick={() => navigate('/')}><strong>Browse live roles</strong><span>Return to the DFW-focused feed</span></button>
            </div>
          </section>
        </aside>

        <main className={styles.mainCol}>
          <section className={styles.statsGrid} aria-label="Career readiness summary">
            <div className={styles.statCard}><span>Live roles</span><strong>{isLoading ? '—' : jobs.length}</strong><small>in the current feed</small></div>
            <div className={styles.statCard}><span>Strong matches</span><strong>{savedResume ? strongMatches : '—'}</strong><small>{savedResume ? 'scoring 70% or higher' : 'upload to calculate'}</small></div>
            <div className={styles.statCard}><span>Average match</span><strong>{averageMatch === null ? '—' : `${averageMatch}%`}</strong><small>{highestMatch === null ? 'resume signal required' : `best match ${highestMatch}%`}</small></div>
            <div className={styles.statCard}><span>Autofill readiness</span><strong>{autofillReadiness.label}</strong><small>{autofillReadiness.detail}</small></div>
          </section>

          {error && <section className={styles.errorCard} role="alert"><div><strong>Live dashboard data is unavailable.</strong><p>{error}</p></div><button type="button" className="btn-outline" onClick={() => setRefreshKey((key) => key + 1)}>Try again</button></section>}

          <section className={styles.dashboardGrid}>
            <div className={styles.panel}>
              <div className={styles.sectionHeader}><div><p className={styles.cardEyebrow}>Resume signal</p><h2>Skill coverage</h2></div><button type="button" className={styles.textButton} onClick={() => navigate('/resume')}>View analysis →</button></div>
              {resumeSkills.length ? <div className={styles.skillChipWrap}>{resumeSkills.map((skill) => <span key={skill} className={styles.skillChip}>{skill}</span>)}</div> : <div className={styles.emptyMini}>Upload a resume to see the skills currently shaping your matches.</div>}
              <div className={styles.panelDivider} />
              <p className={styles.subLabel}>Frequent gaps across top roles</p>
              {skillGaps.length ? <div className={styles.gapList}>{skillGaps.map(([skill, count]) => <div key={skill}><span>{skill}</span><small>{count} role{count === 1 ? '' : 's'}</small></div>)}</div> : <div className={styles.emptyMini}>{savedResume ? 'No repeated skill gaps were found in the current top roles.' : 'Skill opportunities appear after resume matching is active.'}</div>}
            </div>

            <div className={styles.panel}>
              <div className={styles.sectionHeader}><div><p className={styles.cardEyebrow}>Live market</p><h2>Where opportunity is concentrated</h2></div></div>
              {insights?.top_locations?.length ? <div className={styles.marketList}>{insights.top_locations.slice(0, 5).map((location, index) => <div key={location.city}><span><i>{index + 1}</i>{location.city}</span><strong>{location.count} role{location.count === 1 ? '' : 's'}</strong></div>)}</div> : <div className={styles.emptyMini}>{isLoading ? 'Loading live market signals…' : 'No location data is available yet.'}</div>}
              <div className={styles.marketNote}>{insights ? `${insights.overview.remote_jobs} remote and ${insights.overview.hybrid_jobs} hybrid roles are currently represented.` : 'Work-style totals will appear with the live feed.'}</div>
            </div>
          </section>

          <section className={styles.jobSection}>
            <div className={styles.sectionHeader}><div><p className={styles.cardEyebrow}>Recommended next</p><h2>Top opportunities</h2><p className={styles.sectionSub}>{savedResume ? 'Ranked from your current resume against the live feed.' : 'Upload a resume to turn these live roles into personalized matches.'}</p></div><button type="button" className="btn-outline" onClick={() => navigate('/')}>View all roles</button></div>
            <div className={styles.jobList}>
              {isLoading ? [0, 1, 2].map((item) => <div key={item} className={styles.jobSkeleton} />) : topMatches.length ? topMatches.map((job) => (
                <div key={job.id} className={styles.jobRow} role="link" tabIndex={0} aria-label={`View ${job.title} at ${job.company}`} onClick={() => openJob(job.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openJob(job.id) } }}>
                  <div className={styles.jobLogo}>{job.company?.charAt(0) || 'J'}</div>
                  <div className={styles.jobInfo}><div className={styles.jobTopRow}><span className={styles.jobCompany}><IconBriefcase /> {job.company}</span>{savedResume && <span className={styles.matchBadge}>{job.match}% match</span>}</div><strong className={styles.jobTitle}>{job.title}</strong><div className={styles.jobMeta}><span><IconMap /> {job.location}</span><span><IconClock /> {formatPosted(job.posted)}</span></div>{savedResume && <p className={styles.signalText}>{job.matchDetails?.matchedSkills.length ? `Strong overlap: ${job.matchDetails.matchedSkills.slice(0, 3).join(', ')}` : 'No verified skill overlap yet—review the role requirements.'}</p>}</div>
                  <span className={styles.rowArrow} aria-hidden="true">→</span>
                </div>
              )) : <div className={styles.emptyState}>No live opportunities are available yet. Check back after the next feed refresh.</div>}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
