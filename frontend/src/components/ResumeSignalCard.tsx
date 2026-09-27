import type { MarketInsightsResponse } from '../api/jobs'
import styles from './ResumeSignalCard.module.css'

interface Props {
  insights: MarketInsightsResponse | null
  jobCount: number
  hasResume: boolean
}

export function getSignalCenter(insights: MarketInsightsResponse | null, jobCount: number) {
  const skills = insights?.trending_skills?.slice(0, 2).map((item) => item.name) ?? []
  const locations = insights?.top_locations?.slice(0, 2).map((item) => item.city) ?? []

  const feedLabel = jobCount === 1 ? '1 live role in view' : `${jobCount} live roles in view`
  return { skills, locations, feedLabel }
}

export default function ResumeSignalCard({ insights, jobCount, hasResume }: Props) {
  const signal = getSignalCenter(insights, jobCount)

  return (
    <section className={styles.card} aria-label="Resume Signal Center">
      <div className={styles.label}>Resume Signal Center</div>
      <div className={styles.value}>
        {hasResume ? 'Personalized ranking active' : 'Ready to personalize'}
      </div>

      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Strongest Markets</span>
          <span className={styles.rowValue}>
            {signal.locations.length ? signal.locations.join(', ') : 'Waiting for live market data'}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Top Skill Themes</span>
          <span className={styles.rowValue}>
            {signal.skills.length ? signal.skills.join(', ') : 'Waiting for skill signals'}
          </span>
        </div>
      </div>

      <p className={styles.note}>
        {hasResume
          ? `Your resume is shaping rankings for ${signal.feedLabel}.`
          : 'Once uploaded, your resume will drive match quality across the app.'}
      </p>
    </section>
  )
}
