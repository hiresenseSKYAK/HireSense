import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { fetchJob } from '../api/jobs'
import { getJobSummary, type JobSummary } from '../api/career'
import type { Job } from '../types'
import { getResumeAnalysis } from '../utils/resumeStorage'
import { matchResumeToJob } from '../utils/jobMatcher'
import { formatSalary } from '../utils/formatSalary'
import { formatDiscoveryAge, formatPostedDate, sourcePostedAt } from '../utils/jobFreshness'
import JobPreparationPanel from '../components/JobPreparationPanel'
import JobDescription, { formatJobDescription } from '../components/JobDescription'
import styles from './JobDetailPage.module.css'

// Longer descriptions start collapsed so the match and apply sections stay close to the top.
const DESCRIPTION_PREVIEW_CHARS = 900
const NO_DESCRIPTION = 'No description available.'

function jobDescription(job: Job): string {
  const full = job.fullDescription?.trim()
  if (full && full !== NO_DESCRIPTION) return full
  if (typeof job.description === 'string') {
    const text = job.description.trim()
    return text === NO_DESCRIPTION ? '' : text
  }
  if (!job.description) return ''
  return [
    job.description.about,
    ...job.description.responsibilities,
    ...job.description.requirements,
    ...job.description.benefits,
  ].filter(Boolean).join('\n')
}

function previewText(text: string): string {
  if (text.length <= DESCRIPTION_PREVIEW_CHARS) return text
  const cut = text.slice(0, DESCRIPTION_PREVIEW_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > DESCRIPTION_PREVIEW_CHARS * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export default function JobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // The job list passes its own URL (with search, filters, and page) so Back returns there.
  const from = (location.state as { from?: unknown } | null)?.from
  const backTo = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/'
  // Read once per page; re-reading on every render made the skill match recalculate each time.
  const savedResume = useMemo(() => getResumeAnalysis(), [])

  const [job, setJob] = useState<Job | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [logoFailed, setLogoFailed] = useState(false)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [summary, setSummary] = useState<JobSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
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

  const jobId = job?.id
  useEffect(() => {
    if (jobId === undefined) return
    const controller = new AbortController()
    setSummary(null)
    setSummaryLoading(true)
    getJobSummary(jobId, controller.signal)
      .then((result) => setSummary(result))
      .catch(() => { /* Navigated away; the next job loads its own summary. */ })
      .finally(() => { if (!controller.signal.aborted) setSummaryLoading(false) })
    return () => controller.abort()
  }, [jobId])
  useEffect(() => setDescriptionExpanded(false), [id])

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
  const description = useMemo(() => (job ? jobDescription(job) : ''), [job])
  const descriptionPlainText = useMemo(() => formatJobDescription(description).flatMap((block) =>
    'text' in block ? [block.text] : block.items
  ).join(' '), [description])
  const descriptionIsLong = descriptionPlainText.length > DESCRIPTION_PREVIEW_CHARS
  const hasMatchSignal = Boolean(
    matchResult && (matchResult.matchedSkills.length || matchResult.missingSkills.length)
  )

  if (isLoading) {
    return (
      <div className="page">
        <button className={styles.backBtn} onClick={() => navigate(backTo)}>
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
        <button className={styles.backBtn} onClick={() => navigate(backTo)}>
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
      <button className={styles.backBtn} onClick={() => navigate(backTo)}>
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

          <section className={styles.sectionCard} aria-labelledby="role-description-heading">
            <h2 id="role-description-heading" className={styles.sectionTitle}>About the role</h2>
            {summaryLoading && description && (
              <div className={styles.summaryLoading} role="status" aria-label="Summarizing this role">
                <span /><span /><span />
              </div>
            )}
            {!summaryLoading && summary?.source === 'ai' && description ? (
              <>
                <div className={styles.aiSummary}>
                  <span className={styles.aiSummaryLabel}>AI summary</span>
                  <p className={styles.aiSummaryOverview}>{summary.overview}</p>
                  {([
                    ['What you’ll do', summary.responsibilities],
                    ['What they’re looking for', summary.requirements],
                    ['Nice to have', summary.nice_to_have],
                  ] as const).map(([heading, items]) => items.length > 0 && (
                    <div key={heading} className={styles.aiSummaryGroup}>
                      <h3>{heading}</h3>
                      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  ))}
                  <p className={styles.aiSummaryNote}>Summarized by AI from the posting. Check the full description before you apply.</p>
                </div>
                <button
                  type="button"
                  className={styles.descriptionToggle}
                  aria-expanded={descriptionExpanded}
                  aria-controls="role-description"
                  onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                >
                  {descriptionExpanded ? 'Hide full description' : 'Show full description'}
                </button>
                {descriptionExpanded && (
                  <div id="role-description" className={`${styles.descriptionBody} ${styles.fullDescription}`}>
                    <JobDescription content={description} />
                  </div>
                )}
              </>
            ) : summaryLoading && description ? null : description ? (
              <>
                {descriptionExpanded || !descriptionIsLong ? (
                  <div id="role-description" className={styles.descriptionBody}>
                    <JobDescription content={description} />
                  </div>
                ) : (
                  <p id="role-description" className={styles.description}>{previewText(descriptionPlainText)}</p>
                )}
                {descriptionIsLong && (
                  <button
                    type="button"
                    className={styles.descriptionToggle}
                    aria-expanded={descriptionExpanded}
                    aria-controls="role-description"
                    onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                  >
                    {descriptionExpanded ? 'Hide full description' : 'Show full description'}
                  </button>
                )}
              </>
            ) : (
              <p className={styles.matchEmpty}>The source did not provide a description. Open the original listing for full details.</p>
            )}
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
