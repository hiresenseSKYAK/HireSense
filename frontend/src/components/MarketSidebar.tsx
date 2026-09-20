import type { MarketInsightsResponse } from '../api/jobs'
import { IconTrending } from './Icons'
import styles from './MarketSidebar.module.css'

interface Props {
  insights: MarketInsightsResponse | null
  isLoading?: boolean
}

function getPercent(value: number, total: number) {
  if (!total) return 0
  return Math.max(0, Math.round((value / total) * 100))
}

function getTopSignal(insights: MarketInsightsResponse) {
  if (insights.trending_skills.length > 0) {
    return `${insights.trending_skills[0].name} is leading the current market feed.`
  }

  if (insights.top_locations.length > 0) {
    return `${insights.top_locations[0].city} is the strongest hiring location in the current feed.`
  }

  return 'Live market patterns will appear here as more jobs are processed.'
}

export default function MarketSidebar({ insights, isLoading = false }: Props) {
  if (isLoading) {
    return (
      <aside className={styles.sidebar}>
        <div className={`${styles.card} ${styles.featureCard}`}>
          <div className={styles.cardTitle}>
            <span className={styles.titleAccent} />
            <IconTrending /> Market Overview
          </div>
          <div className={styles.muted}>Loading insights...</div>
        </div>
      </aside>
    )
  }

  if (!insights) {
    return (
      <aside className={styles.sidebar}>
        <div className={`${styles.card} ${styles.featureCard}`}>
          <div className={styles.cardTitle}>
            <span className={styles.titleAccent} />
            <IconTrending /> Market Overview
          </div>
          <div className={styles.muted}>Insights unavailable right now.</div>
        </div>
      </aside>
    )
  }

  const totalJobs = insights.overview.total_jobs
  const workStyles = [
    { label: 'Remote', value: insights.overview.remote_jobs },
    { label: 'Hybrid', value: insights.overview.hybrid_jobs },
    { label: 'On-site', value: insights.overview.onsite_jobs },
  ]

  return (
    <aside className={styles.sidebar}>
      <div className={`${styles.card} ${styles.featureCard}`}>
        <div className={styles.cardTitle}>
          <span className={styles.titleAccent} />
          <IconTrending /> Market Overview
        </div>
        <div className={styles.statValue}>{totalJobs}</div>
        <div className={styles.statLabel}>active roles in the current feed</div>

        <div className={styles.featureDivider} />

        <div className={styles.featureNoteLabel}>AI Insight</div>
        <div className={styles.featureNote}>{getTopSignal(insights)}</div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <span className={styles.titleAccent} />
          Work Style Split
        </div>

        <div className={styles.progressList}>
          {workStyles.map((item) => {
            const percent = getPercent(item.value, totalJobs)

            return (
              <div key={item.label} className={styles.progressItem}>
                <div className={styles.progressHeader}>
                  <span className={styles.rowLabel}>{item.label}</span>
                  <div className={styles.progressMeta}>
                    <span className={styles.rowValue}>{item.value}</span>
                    <span className={styles.progressPct}>{percent}%</span>
                  </div>
                </div>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <span className={styles.titleAccent} />
          Trending Skills
        </div>

        <div className={styles.list}>
          {insights.trending_skills.length > 0 ? (
            insights.trending_skills.map((skill, index) => (
              <div key={skill.name} className={styles.enhancedRow}>
                <div className={styles.rowLeft}>
                  <span className={styles.rankBadge}>{index + 1}</span>
                  <span className={styles.skillPill}>{skill.name}</span>
                </div>
                <span className={styles.countBadge}>{skill.count}</span>
              </div>
            ))
          ) : (
            <div className={styles.muted}>No skills available yet.</div>
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <span className={styles.titleAccent} />
          Top Locations
        </div>

        <div className={styles.progressList}>
          {insights.top_locations.length > 0 ? (
            insights.top_locations.map((location) => {
              const percent = getPercent(location.count, totalJobs)

              return (
                <div key={location.city} className={styles.progressItem}>
                  <div className={styles.progressHeader}>
                    <span className={styles.rowLabel}>{location.city}</span>
                    <div className={styles.progressMeta}>
                      <span className={styles.rowValue}>{location.count}</span>
                      <span className={styles.progressPct}>{percent}%</span>
                    </div>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFillSoft}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })
          ) : (
            <div className={styles.muted}>No locations available yet.</div>
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <span className={styles.titleAccent} />
          Top Companies
        </div>

        <div className={styles.progressList}>
          {insights.top_companies.length > 0 ? (
            insights.top_companies.map((company) => {
              const percent = getPercent(company.count, totalJobs)

              return (
                <div key={company.name} className={styles.progressItem}>
                  <div className={styles.progressHeader}>
                    <span className={styles.rowLabel}>{company.name}</span>
                    <div className={styles.progressMeta}>
                      <span className={styles.rowValue}>{company.count}</span>
                      <span className={styles.progressPct}>{percent}%</span>
                    </div>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFillSoft}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })
          ) : (
            <div className={styles.muted}>No companies available yet.</div>
          )}
        </div>
      </div>
    </aside>
  )
}