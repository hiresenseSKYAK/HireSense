import type { MarketInsightsResponse } from '../api/jobs'
import styles from './ResumeSignalCard.module.css'

interface Props {
  insights: MarketInsightsResponse | null
  jobCount: number
  hasResume: boolean
}

export function getSignalCenter(insights: MarketInsightsResponse | null, jobCount: number) {
  const topSkill = insights?.trending_skills?.[0]?.name ?? 'Python'
  const secondSkill = insights?.trending_skills?.[1]?.name ?? 'Cloud'
  const topLocation = insights?.top_locations?.[0]?.city ?? 'Dallas'
  const secondLocation = insights?.top_locations?.[1]?.city ?? 'Plano'

  let confidence = 'Building signal'
  if (jobCount >= 100) confidence = 'High match confidence'
  else if (jobCount >= 25) confidence = 'Strong match signal'
  else if (jobCount > 0) confidence = 'Emerging match signal'

  return { topSkill, secondSkill, topLocation, secondLocation, confidence }
}

export default function ResumeSignalCard({ insights, jobCount, hasResume }: Props) {
  const signal = getSignalCenter(insights, jobCount)

  return (
    <section className={styles.card} aria-label="Resume Signal Center">
      <div className={styles.label}>Resume Signal Center</div>
      <div className={styles.value}>
        {hasResume ? signal.confidence : 'Ready to personalize'}
      </div>

      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Strongest Markets</span>
          <span className={styles.rowValue}>
            {signal.topLocation}, {signal.secondLocation}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Top Skill Themes</span>
          <span className={styles.rowValue}>
            {signal.topSkill}, {signal.secondSkill}
          </span>
        </div>
      </div>

      <p className={styles.note}>
        {hasResume
          ? 'Your resume is actively shaping match rankings across the feed.'
          : 'Once uploaded, your resume will drive match quality across the app.'}
      </p>
    </section>
  )
}
