import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Job } from '../types'
import styles from './JobCard.module.css'
import { IconBriefcase, IconMap, IconClock, IconCheck } from './Icons'
import { formatSalary } from '../utils/formatSalary'
import { formatDiscoveryAge, formatPostedDate, sourcePostedAt } from '../utils/jobFreshness'

interface Props {
  job: Job
  showMatch?: boolean
}

function getCardDescription(job: Job) {
  let text = ''

  if (typeof job.description === 'string') {
    text = job.description.trim()
  } else if (job.description?.about) {
    text = job.description.about.trim()
  }

  if (!text) {
    return ''
  }

  const headingPattern =
    /^(overview|responsibilities|requirements|qualifications|benefits|about)$/i
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const firstContent =
    lines.find(
      (line) =>
        !headingPattern.test(line.replace(/^#+\s*/, '')) && !/^[-•*]\s/.test(line)
    ) || text

  return firstContent.replace(/^overview[:\s-]+/i, '').trim()
}

export default function JobCard({ job, showMatch = false }: Props) {
  const navigate = useNavigate()
  const resolvedLogo = job.companyLogoUrl || job.logo || ''
  const [logoFailed, setLogoFailed] = useState(false)
  useEffect(() => setLogoFailed(false), [resolvedLogo])

  const hybridTone =
    job.hybrid === 'Remote'
      ? styles.remote
      : job.hybrid === 'Hybrid'
      ? styles.hybrid
      : styles.onsite

  const description = getCardDescription(job)
  const visibleTags = Array.isArray(job.tags) ? job.tags.slice(0, 4) : []
  const hiddenTagCount = Math.max(0, (job.tags?.length ?? 0) - visibleTags.length)
  const postedText = formatPostedDate(sourcePostedAt(job))
  const discoveryText = formatDiscoveryAge(job.firstSeenAt)
  const salaryText = formatSalary(job.salary ?? job.salaryRange)
  const logoUrl = /^https?:\/\//i.test(resolvedLogo) && !logoFailed ? resolvedLogo : ''
  const sourceLabel = job.source ? job.source.charAt(0).toUpperCase() + job.source.slice(1) : null
  const hasMatchSignal = Boolean(
    showMatch
    && job.matchDetails
    && (job.matchDetails.matchedSkills.length || job.matchDetails.missingSkills.length)
  )

  return (
    <article
      className={styles.card}
      onClick={() => navigate(`/jobs/${job.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(`/jobs/${job.id}`)
        }
      }}
      role="link"
      tabIndex={0}
      aria-label={`View ${job.title} at ${job.company}`}
    >
      <div className={styles.logoWrap}>
        <div className={styles.logo}>
          {logoUrl ? (
            <img src={logoUrl} alt={`${job.company} logo`} onError={() => setLogoFailed(true)} />
          ) : (
            <span aria-hidden="true">{job.company?.charAt(0).toUpperCase() || '?'}</span>
          )}
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.topRow}>
          <div className={styles.titleBlock}>
            <div className={styles.companyRow}>
              <div className={styles.company}>{job.company}</div>
              {sourceLabel && <span className={styles.sourceBadge}>{sourceLabel}</span>}
            </div>
            <h3 className={styles.title}>{job.title}</h3>

            <div className={styles.meta}>
              <span className={styles.metaItem}>
                <IconMap /> {job.location}
              </span>
              <span className={`${styles.metaPill} ${hybridTone}`}>{job.hybrid}</span>
              {job.experienceLevel && <span className={styles.metaItem}><IconBriefcase /> {job.experienceLevel}</span>}
            </div>
          </div>

          <div className={styles.right}>
            {salaryText !== 'Not listed' && <div className={styles.salary}>{salaryText}</div>}
            <div className={styles.type}>{job.type}</div>
            {postedText && <div className={styles.posted}><IconClock /> Posted {postedText}</div>}
            {discoveryText && <div className={styles.discovered}>{discoveryText}</div>}
          </div>
        </div>

        {description && <p className={styles.description}>{description}</p>}

        <div className={styles.bottomRow}>
          <div className={styles.tagsWrap}>
            <div className={styles.tags}>
              {visibleTags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
              {hiddenTagCount > 0 && <span className={styles.moreTag}>+{hiddenTagCount}</span>}
            </div>
          </div>

          {hasMatchSignal && (
            <div className={styles.matchWrap}>
              <div className={styles.matchBadge}><IconCheck /> {job.match}% match</div>
              <div className={styles.matchHint}>
                {job.matchDetails?.matchedSkills.length
                  ? `Overlap: ${job.matchDetails.matchedSkills.slice(0, 2).join(', ')}`
                  : 'No listed skill overlap yet'}
              </div>
              {!!job.matchDetails?.missingSkills.length && (
                <div className={styles.gapHint}>Gap: {job.matchDetails.missingSkills.slice(0, 2).join(', ')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
