import { useNavigate } from 'react-router-dom'
import type { Job } from '../types'
import styles from './JobCard.module.css'
import { IconBriefcase, IconMap, IconClock, IconCheck } from './Icons'
import { formatSalary } from '../utils/formatSalary'

interface Props {
  job: Job
  showMatch?: boolean
}

function formatPosted(value?: string) {
  if (!value) return 'Recently posted'

  const trimmed = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }
  }

  return trimmed
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

  const hybridTone =
    job.hybrid === 'Remote'
      ? styles.remote
      : job.hybrid === 'Hybrid'
      ? styles.hybrid
      : styles.onsite

  const badgeText = job.badge ? job.badge.toUpperCase() : null
  const description = getCardDescription(job)
  const visibleTags = Array.isArray(job.tags) ? job.tags.slice(0, 4) : []
  const hiddenTagCount = Math.max(0, (job.tags?.length ?? 0) - visibleTags.length)
  const postedText = formatPosted(job.posted)
  const salaryText = formatSalary(job.salary ?? job.salaryRange)
  const logoUrl = /^https?:\/\//i.test(job.logo || '') ? job.logo : ''

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
            <img src={logoUrl} alt={`${job.company} logo`} />
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
              <div className={styles.topBadges}>
                {badgeText && <span className={styles.badge}>{badgeText}</span>}
              </div>
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
            <div className={styles.salary}>{salaryText}</div>
            <div className={styles.type}>{job.type}</div>
            <div className={styles.posted}><IconClock /> {postedText}</div>
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

          {showMatch && (
            <div className={styles.matchWrap}>
              <div className={styles.matchBadge}><IconCheck /> {job.match}% match</div>
              <div className={styles.matchHint}>Based on verified skill overlap</div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
