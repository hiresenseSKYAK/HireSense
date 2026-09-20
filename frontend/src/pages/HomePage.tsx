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
import styles from './HomePage.module.css'

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
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(buildEmptyFilters())
  const [jobs, setJobs] = useState<Job[]>([])
  const [insights, setInsights] = useState<MarketInsightsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const pageRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  useStickyOffsets(pageRef, controlsRef)

  const savedResume = getResumeAnalysis()

  useEffect(() => {
    async function loadHomeData() {
      try {
        setIsLoading(true)
        setError('')

        const [jobsData, insightsData] = await Promise.all([
          fetchJobs(),
          fetchMarketInsights(),
        ])

        setJobs(jobsData)
        setInsights(insightsData)
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
  }, [])

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
    .sort((a, b) => b.match - a.match)
    .map((job, index) => {
      if (index < 3 && !job.badge) {
        return { ...job, badge: 'Live' }
      }
      return job
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

          <button className="btn-primary" style={{ height: '58px', minWidth: '136px' }}>
            Search
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

        <section className={styles.jobsSection}>
          <div className={styles.jobsSectionHeader}>
            <div>
              <h2 className={styles.jobsTitle}>Top Matches</h2>
              <p className={styles.jobsSubtitle}>
                {savedResume
                  ? 'Sorted by how well your uploaded resume aligns with each role.'
                  : 'Upload a resume to personalize this feed.'}
              </p>
            </div>
          </div>

          <div className={styles.jobsList}>
            {isLoading ? (
              <div className={styles.emptyState}>
                <p>Loading job listings...</p>
              </div>
            ) : error ? (
              <div className={styles.emptyState}>
                <p>{error}</p>
              </div>
            ) : filteredJobs.length > 0 ? (
              filteredJobs.map((job) => <JobCard key={job.id} job={job} />)
            ) : jobs.length === 0 ? (
              <div className={styles.emptyState}>
                <p>No live jobs are available right now. Please check back after the next feed refresh.</p>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p>No jobs matched your current search and filters.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
