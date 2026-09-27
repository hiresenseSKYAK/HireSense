import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { fetchJob } from '../api/jobs'
import type { Job } from '../types'
import { getResumeAnalysis } from '../utils/resumeStorage'
import { matchResumeToJob } from '../utils/jobMatcher'
import { formatSalary } from '../utils/formatSalary'
import { formatDiscoveryAge, formatPostedDate, sourcePostedAt } from '../utils/jobFreshness'
import AIInterviewPanel from '../components/AIInterviewPanel'
import styles from './JobDetailPage.module.css'

type DescriptionSection = {
  heading?: string
  items: string[]
}

function normalizeDescriptionText(job: Job | null): string {
  if (!job) {
    return ''
  }

  if (typeof job.description === 'string') {
    return job.description.trim()
  }

  if (job.description?.about) {
    return job.description.about.trim()
  }

  return ''
}

function cleanDescriptionText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u2022/g, '\n• ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function sentenceSplitToParagraphs(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return []
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  if (sentences.length <= 3) {
    return sentences
  }

  const paragraphs: string[] = []

  for (let i = 0; i < sentences.length; i += 3) {
    paragraphs.push(sentences.slice(i, i + 3).join(' '))
  }

  return paragraphs
}

function buildDescriptionSections(text: string): DescriptionSection[] {
  const cleaned = cleanDescriptionText(text)

  if (!cleaned) {
    return []
  }

  const rawLines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const headingPattern =
    /^(about|overview|responsibilities|requirements|qualifications|preferred qualifications|preferred skills|skills|what you'll do|what you will do|benefits|why join|who you are|what we're looking for|what we are looking for)$/i

  const bulletPattern = /^([•\-*]\s+|\d+\.\s+)/
  const hasStructure = rawLines.some((line) => headingPattern.test(line) || bulletPattern.test(line))

  if (!hasStructure) {
    return [
      {
        heading: 'Overview',
        items: sentenceSplitToParagraphs(cleaned),
      },
    ]
  }

  const sections: DescriptionSection[] = []
  let currentSection: DescriptionSection = {
    heading: 'Overview',
    items: [],
  }

  for (const rawLine of rawLines) {
    const line = rawLine.trim()

    if (headingPattern.test(line)) {
      if (currentSection.items.length > 0) {
        sections.push(currentSection)
      }

      currentSection = {
        heading: line,
        items: [],
      }
      continue
    }

    if (bulletPattern.test(line)) {
      currentSection.items.push(line.replace(bulletPattern, '').trim())
      continue
    }

    const splitParagraphs = sentenceSplitToParagraphs(line)

    if (splitParagraphs.length > 0) {
      currentSection.items.push(...splitParagraphs)
    }
  }

  if (currentSection.items.length > 0) {
    sections.push(currentSection)
  }

  return sections.length > 0
    ? sections
    : [
        {
          heading: 'Overview',
          items: sentenceSplitToParagraphs(cleaned),
        },
      ]
}

function formatSectionHeading(value?: string): string {
  if (!value) {
    return 'Overview'
  }

  return value
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

export default function JobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const savedResume = getResumeAnalysis()

  const [job, setJob] = useState<Job | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [logoFailed, setLogoFailed] = useState(false)

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

  const descriptionSections = useMemo(() => {
    const text = normalizeDescriptionText(job)
    return buildDescriptionSections(text)
  }, [job])

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
    <div className="page">
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
                  <span>•</span>
                  <span>{job.type}</span>
                  {formatPostedDate(sourcePostedAt(job)) && <><span>•</span><span>Posted {formatPostedDate(sourcePostedAt(job))}</span></>}
                </div>
                  <div className={styles.freshnessRow}>
                    {formatDiscoveryAge(job.firstSeenAt) && <span>{formatDiscoveryAge(job.firstSeenAt)}</span>}
                    {job.source && <span>Source: {job.source}</span>}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Role Overview</h2>

            {descriptionSections.length > 0 ? (
              <div className={styles.descriptionLayout}>
                {descriptionSections.map((section, index) => (
                  <div
                    key={`${section.heading || 'section'}-${index}`}
                    className={styles.descriptionBlock}
                  >
                    <h3 className={styles.descriptionHeading}>
                      {formatSectionHeading(section.heading)}
                    </h3>

                    <div className={styles.descriptionContent}>
                      {section.items.map((item, itemIndex) => (
                        <p
                          key={`${section.heading || 'section'}-${itemIndex}`}
                          className={styles.descriptionParagraph}
                        >
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.description}>No description available.</p>
            )}
          </section>

          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Key Skills</h2>
            <div className={styles.tagsWrap}>
              {Array.isArray(job.tags) && job.tags.length > 0 ? (
                job.tags.map((tag) => (
                  <span key={tag} className={styles.skillTag}>
                    {tag}
                  </span>
                ))
              ) : (
                <div className={styles.matchEmpty}>
                  No structured skills were available for this job.
                </div>
              )}
            </div>
          </section>

          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Details</h2>
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
                <div className={styles.detailLabel}>Posted</div>
                <div className={styles.detailValue}>{formatPostedDate(sourcePostedAt(job)) || 'Not provided by source'}</div>
              </div>
            </div>
          </section>
        </main>

        <aside className={styles.sidebar}>
          <div className={styles.matchCard}>
            <div className={styles.matchLabel}>Your Match Score</div>

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
                <div className={styles.scoreCircle}>
                  <span className={styles.scoreValue}>{matchResult.matchScore}%</span>
                </div>

                <div className={styles.matchSummary}>{matchResult.recommendation}</div>

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

              </>
            )}

            {job.applicationLink && (
              <a className={`btn-primary ${styles.applyButton}`} href={job.applicationLink} target="_blank" rel="noopener noreferrer">
                Apply directly →
              </a>
            )}
          </div>

          <div className={styles.interviewCard}>
            <AIInterviewPanel
              jobId={job.id}
              jobTitle={job.title}
              company={job.company}
              resumeData={savedResume?.parsed_data ?? null}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
