import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import JobCard from '../components/JobCard'
import MarketSidebar from '../components/MarketSidebar'
import ResumeSignalCard from '../components/ResumeSignalCard'
import FilterBar, { buildEmptyFilters, type FilterState } from '../components/FilterBar'
import { IconSearch } from '../components/Icons'
import { fetchJobs, fetchMarketInsights, type MarketInsightsResponse } from '../api/jobs'
import { getResumeAnalysis } from '../utils/resumeStorage'
import { matchResumeToJob } from '../utils/jobMatcher'
import {
  jobMatchesCity,
  jobMatchesDatePosted,
  jobMatchesSalary,
  uniqueCitiesFromJobs,
} from '../utils/jobFilters'
import type { Job } from '../types'
import { sourcePostedAt, timestampValue } from '../utils/jobFreshness'
import styles from './HomePage.module.css'

type SortOption = 'best-match' | 'newest-posted' | 'recently-discovered' | 'company' | 'location'

function useStickyOffsets(
  pageRef: RefObject<HTMLDivElement>,
  controlsRef: RefObject<HTMLDivElement>,
) {
  useLayoutEffect(() => {
    const page = pageRef.current
    const controls = controlsRef.current
    if (!page || !controls) return

    const nav = document.querySelector<HTMLElement>('nav')
    const update = () => {
      page.style.setProperty('--nav-h', `${nav?.offsetHeight ?? 61}px`)
      page.style.setProperty('--controls-h', `${controls.offsetHeight}px`)
    }
    update()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(controls)
    if (nav) observer.observe(nav)
    return () => observer.disconnect()
  }, [pageRef, controlsRef])
}

export default function HomePage() {
  const savedResume = getResumeAnalysis()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(buildEmptyFilters())
  const [jobs, setJobs] = useState<Job[]>([])
  const [insights, setInsights] = useState<MarketInsightsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [sortBy, setSortBy] = useState<SortOption>(savedResume ? 'best-match' : 'recently-discovered')

  const pageRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  useStickyOffsets(pageRef, controlsRef)

  useEffect(() => {
    async function loadHomeData() {
      try {
        setIsLoading(true)
        setError('')

        const [jobsResult, insightsResult] = await Promise.allSettled([
          fetchJobs(),
          fetchMarketInsights(),
        ])
        if (jobsResult.status === 'rejected') throw jobsResult.reason
        setJobs(jobsResult.value)
        setInsights(insightsResult.status === 'fulfilled' ? insightsResult.value : null)
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Failed to load jobs.')
        }
      } finally {
        setIsLoading(false)
      }
    }

    void loadHomeData()
  }, [loadKey])

  const jobsWithMatch = useMemo(() => {
    return jobs.map((job) => {
      const matchResult = matchResumeToJob(savedResume?.parsed_data, job)

      return {
        ...job,
        match: matchResult.matchScore,
        matchDetails: matchResult,
      }
    })
  }, [jobs, savedResume])

  const cityOptions = useMemo(() => uniqueCitiesFromJobs(jobs), [jobs])

  const filteredJobs = jobsWithMatch
    .filter((job) => {
      const q = query.toLowerCase()

      const matchesQuery =
        !q ||
        job.title.toLowerCase().includes(q) ||
        job.company.toLowerCase().includes(q) ||
        job.tags.some((t: string) => t.toLowerCase().includes(q))

      const matchesStyle =
        filters.style.size === 0 || filters.style.has(job.hybrid)
      const matchesExp =
        filters.experience.size === 0 ||
        filters.experience.has(job.experienceLevel ?? '')
      const matchesType =
        filters.type.size === 0 || filters.type.has(job.type)

      return (
        matchesQuery &&
        jobMatchesCity(job, filters.city) &&
        matchesStyle &&
        matchesExp &&
        jobMatchesSalary(job, filters.salary) &&
        matchesType &&
        jobMatchesDatePosted(job, filters.date)
      )
    })
    .sort((a, b) => {
      if (sortBy === 'best-match') return b.match - a.match
      if (sortBy === 'newest-posted') return timestampValue(sourcePostedAt(b)) - timestampValue(sourcePostedAt(a))
      if (sortBy === 'recently-discovered') return timestampValue(b.firstSeenAt) - timestampValue(a.firstSeenAt)
      if (sortBy === 'company') return a.company.localeCompare(b.company)
      return a.location.localeCompare(b.location)
    })

  return (
    <div className="page" ref={pageRef}>
      {/* Not sticky: Compact hero banner */}
      <section className={styles.hero}>
        <div className={styles.heroEyebrow}>Early-career job discovery</div>
        <h1 className={styles.heroTitle}>
          Find the internships and entry-level roles that actually{' '}
          <span className={styles.heroAccent}>fit you</span>.
        </h1>
        <p className={styles.heroSub}>
          HireSense turns live internship and entry-level job data into a personalized feed.
          Upload your resume, compare against real roles, and instantly see where you match
          and what skills you still need.
        </p>
      </section>

      {/* Sticky: search + filters */}
      <div className={styles.controls} ref={controlsRef}>
        <div className={styles.searchWrap}>
          <div className={styles.searchBar}>
            <IconSearch />
            <input
              type="text"
              placeholder="Search by title, company, or skill..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ height: '58px', minWidth: '136px' }}
            onClick={() => document.getElementById('job-results')?.scrollIntoView({ behavior: 'smooth' })}
          >
            View {filteredJobs.length}
          </button>
        </div>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          resultCount={filteredJobs.length}
          cityOptions={cityOptions}
        />
      </div>

      <div className={styles.layout}>
        {/* Sticky: Market Overview + Resume Signal Center */}
        <div className={styles.rail}>
          <MarketSidebar
            insights={insights}
            isLoading={isLoading}
            afterOverview={
              <ResumeSignalCard
                insights={insights}
                jobCount={filteredJobs.length}
                hasResume={Boolean(savedResume)}
              />
            }
          />
        </div>

        <section className={styles.jobsSection} id="job-results" aria-busy={isLoading}>
          <div className={styles.jobsSectionHeader}>
            <div>
              <h2 className={styles.jobsTitle}>{savedResume && sortBy === 'best-match' ? 'Top Matches' : 'Live Opportunities'}</h2>
              <p className={styles.jobsSubtitle}>
                {savedResume
                  ? 'Use truthful resume overlap, posting dates, and discovery freshness to prioritize your search.'
                  : 'Sorted by when HireSense discovered each role. Upload a resume to add skill matching.'}
              </p>
            </div>
            <label className={styles.sortControl}>
              <span>Sort by</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}>
                <option value="best-match" disabled={!savedResume}>Best Match</option>
                <option value="newest-posted">Newest Posted</option>
                <option value="recently-discovered">Recently Discovered</option>
                <option value="company">Company</option>
                <option value="location">Location</option>
              </select>
            </label>
          </div>

          <div className={styles.jobsList}>
            {isLoading ? (
              <div className={styles.skeletonList} aria-label="Loading job listings">
                {[0, 1, 2].map((item) => (
                  <div className={styles.skeletonCard} key={item}>
                    <span className={styles.skeletonLogo} />
                    <div className={styles.skeletonBody}>
                      <span className={styles.skeletonLineWide} />
                      <span className={styles.skeletonLine} />
                      <span className={styles.skeletonLineShort} />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className={`${styles.emptyState} ${styles.errorState}`} role="alert">
                <strong>We couldn’t load the live feed.</strong>
                <p>{error}</p>
                <button type="button" className="btn-outline" onClick={() => setLoadKey((key) => key + 1)}>
                  Try again
                </button>
              </div>
            ) : filteredJobs.length > 0 ? (
              filteredJobs.map((job) => <JobCard key={job.id} job={job} showMatch={Boolean(savedResume)} />)
            ) : jobs.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>The live feed is between refreshes.</strong>
                <p>No qualifying DFW or explicit U.S.-remote roles are available right now.</p>
                <button type="button" className="btn-outline" onClick={() => setLoadKey((key) => key + 1)}>Refresh feed</button>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <strong>No roles match those filters.</strong>
                <p>Clear a filter or broaden your search to see more of the live feed.</p>
                <button type="button" className="btn-outline" onClick={() => { setQuery(''); setFilters(buildEmptyFilters()) }}>
                  Reset search
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
