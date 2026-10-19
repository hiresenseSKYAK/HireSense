import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { fetchJob } from '../api/jobs'
import type { Job } from '../types'
import { getResumeAnalysis } from '../utils/resumeStorage'
import { matchResumeToJob } from '../utils/jobMatcher'
import { formatSalary } from '../utils/formatSalary'
import { formatDiscoveryAge, formatPostedDate, sourcePostedAt } from '../utils/jobFreshness'
import JobPreparationPanel from '../components/JobPreparationPanel'
import styles from './JobDetailPage.module.css'

export default function JobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const savedResume = getResumeAnalysis()

  const [job, setJob] = useState<Job | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [logoFailed, setLogoFailed] = useState(false)
  const [openedApplicationJobId, setOpenedApplicationJobId] = useState(() => {
    try { return sessionStorage.getItem('hiresense_last_opened_application_job') } catch { return null }
  })

  useEffect(() => {
    async function loadJob() {
      if (!id) {
        setError('Missing job id.')
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError('')
        const data = await fetchJob(Number(id))
        setJob(data)
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Failed to load job details.')
        }
      } finally {
        setIsLoading(false)
      }
    }

    void loadJob()
  }, [id, loadKey])

  const matchResult = useMemo(() => {
    if (!job) {
      return null
    }

    return matchResumeToJob(savedResume?.parsed_data, job)
  }, [job, savedResume])

  const salaryText = useMemo(() => {
    if (!job) {
      return 'N/A'
    }

    return formatSalary(job.salaryRange || job.salary)
  }, [job])
  const hasMatchSignal = Boolean(
    matchResult && (matchResult.matchedSkills.length || matchResult.missingSkills.length)
  )

  if (isLoading) {
    return (
      <div className="page">
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back to Jobs
        </button>
        <div className={styles.detailSkeleton} aria-label="Loading job details">
          <span /><span /><span /><span />
        </div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="page">
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back to Jobs
        </button>
        <div className={styles.emptyState} role="alert">
          <strong>{error || 'Job not found.'}</strong>
          <button type="button" className="btn-outline" onClick={() => setLoadKey((key) => key + 1)}>Try again</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`page ${styles.page}`}>
      <button className={styles.backBtn} onClick={() => navigate('/')}>
        ← Back to Jobs
      </button>

      <div className={styles.layout}>
        <main className={styles.main}>
          <section className={styles.heroCard}>
            <div className={styles.heroTopRow}>
              <div className={styles.identityBlock}>
                <div className={styles.companyLogo}>
                  {(job.companyLogoUrl || job.logo) && !logoFailed
                    ? <img src={job.companyLogoUrl || job.logo} alt={`${job.company} logo`} onError={() => setLogoFailed(true)} />
                    : <span aria-hidden="true">{job.company.charAt(0).toUpperCase()}</span>}
                </div>
                <div>
                  <div className={styles.company}>{job.company}</div>
                  <h1 className={styles.jobTitle}>{job.title}</h1>
                  <div className={styles.jobMeta}>
                  <span>{job.location}</span>
                  <span>•</span>
                  <span>{job.hybrid}</span>
                </div>
                  <div className={styles.freshnessRow}>
                    {formatDiscoveryAge(job.firstSeenAt) && <span>{formatDiscoveryAge(job.firstSeenAt)}</span>}
                    {job.source === 'adzuna' ? <a href="https://www.adzuna.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', minWidth: 116, minHeight: 23 }}>Adzuna</a> : job.source && <span>Source: {job.directEmployerListing ? 'Direct employer listing' : job.source}</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.detailsGrid}>
              <div className={styles.detailCard}>
                <div className={styles.detailLabel}>Experience</div>
                <div className={styles.detailValue}>{job.experienceLevel || 'N/A'}</div>
              </div>
              <div className={styles.detailCard}>
                <div className={styles.detailLabel}>Compensation</div>
                <div className={styles.detailValue}>{salaryText}</div>
              </div>
              <div className={styles.detailCard}>
                <div className={styles.detailLabel}>Job Type</div>
                <div className={styles.detailValue}>{job.type}</div>
              </div>
              <div className={styles.detailCard}>
                <div className={styles.detailLabel}>{job.source === 'adzuna' ? 'Adzuna ad date' : 'Posted'}</div>
                <div className={styles.detailValue}>{formatPostedDate(sourcePostedAt(job)) || 'Not provided by source'}</div>
              </div>
            </div>
          </section>

          <section className={styles.matchCard}>
            <div className={styles.matchLabel}>Resume skill alignment</div>

            {!savedResume || !matchResult ? (
              <>
                <div className={styles.matchEmpty}>
                  Upload a resume to see your personalized match breakdown.
                </div>
                <Link
                  to="/resume"
                  className="btn-primary"
                  style={{
                    width: '100%',
                    padding: '11px',
                    justifyContent: 'center',
                    marginTop: '14px',
                  }}
                >
                  Upload Resume
                </Link>
              </>
            ) : !hasMatchSignal ? (
              <div className={styles.matchEmpty}>This source has not provided enough structured skill evidence for a reliable percentage yet. Review the role requirements directly.</div>
            ) : (
              <>
                <div className={styles.matchTop}>
                  <div className={styles.scoreCircle}>
                    <span className={styles.scoreValue}>{matchResult.matchScore}%</span>
                  </div>
                  <div className={styles.matchSummary}>{matchResult.recommendation}</div>
                </div>
                <p className={styles.matchEmpty}>Based on listed skills in your resume and this posting; this is not a hiring prediction.</p>

                <div className={styles.matchSections}>
                <div className={styles.matchSection}>
                  <div className={styles.matchSectionTitle}>Matched Skills</div>
                  {matchResult.matchedSkills.length > 0 ? (
                    <div className={styles.tagsWrap}>
                      {matchResult.matchedSkills.map((skill) => (
                        <span key={skill} className={styles.matchTagGood}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.matchEmpty}>No strong overlap found yet.</div>
                  )}
                </div>

                <div className={styles.matchSection}>
                  <div className={styles.matchSectionTitle}>Missing Skills</div>
                  {matchResult.missingSkills.length > 0 ? (
                    <div className={styles.tagsWrap}>
                      {matchResult.missingSkills.map((skill) => (
                        <span key={skill} className={styles.matchTagMissing}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.matchEmpty}>
                      You already cover the listed job skills.
                    </div>
                  )}
                </div>
                </div>

              </>
            )}

            {job.applicationLink && (
              <a className={`btn-primary ${styles.applyButton}`} href={job.applicationLink} target="_blank" rel="noopener noreferrer" onClick={() => { setOpenedApplicationJobId(String(job.id)); try { sessionStorage.setItem('hiresense_last_opened_application_job', String(job.id)) } catch { /* Optional return state. */ } }}>
                Apply directly →
              </a>
            )}
          </section>
          <JobPreparationPanel jobId={job.id} resume={savedResume?.parsed_data ?? null} />
          <section className={styles.interviewEntry} aria-labelledby="interview-entry-title">
            <div className={styles.journeyLabel}>Understand role <span>→</span> Prepare <span>→</span> <strong>Practice</strong> <span>→</span> Review</div>
            {openedApplicationJobId === String(job.id) && <div className={styles.applicationNote}><span aria-hidden="true">↗</span><div><strong>You chose Apply directly</strong><p>Submission happens on the employer’s site. Whenever you’re ready, prepare for the conversation here.</p></div></div>}
            <div className={styles.interviewEntryContent}><div><span className={styles.interviewEyebrow}>HireSense interview practice</span><h2 id="interview-entry-title">Practice this role with purpose.</h2><p>Step into a focused interview shaped by this job and your resume, then review detailed coaching afterward.</p><div className={styles.interviewFacts}><span>5–12 minutes</span><span>Role-specific</span><span>Personalized feedback</span></div></div><Link className="btn-primary" to={`/interviews/new/${job.id}`}>Practice this role →</Link></div>
          </section>
        </main>
      </div>
    </div>
  )
}
