import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import JobCard from '../components/JobCard'
import MarketSidebar from '../components/MarketSidebar'
import FilterBar, { buildEmptyFilters, type FilterState } from '../components/FilterBar'
import { IconSearch } from '../components/Icons'
import { fetchJobs, fetchMarketInsights, JOB_PAGE_SIZE, type MarketInsightsResponse } from '../api/jobs'
import { getResumeAnalysis } from '../utils/resumeStorage'
import type { Job } from '../types'
import styles from './HomePage.module.css'

type SortOption = 'best-match' | 'newest-posted' | 'recently-discovered' | 'company' | 'location'

function selected(filters: FilterState, id: string) {
  return [...(filters[id] ?? [])]
}

function filtersKey(filters: FilterState) {
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .map((key) => [key, [...(filters[key] ?? [])].sort()])
  )
}

function pageTokens(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)

  const pages = [1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total)
  const unique = [...new Set(pages)].sort((a, b) => a - b)
  const tokens: Array<number | 'gap'> = []
  for (const pageNumber of unique) {
    const previous = tokens[tokens.length - 1]
    if (typeof previous === 'number' && pageNumber - previous > 1) tokens.push('gap')
    tokens.push(pageNumber)
  }
  return tokens
}

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
  const resumeSkills = savedResume?.parsed_data.skills?.filter(Boolean) ?? []
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(buildEmptyFilters())
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(JOB_PAGE_SIZE)
  const [cities, setCities] = useState<string[]>([])
  const [insights, setInsights] = useState<MarketInsightsResponse | null>(null)
  const [isJobsLoading, setIsJobsLoading] = useState(true)
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [sortBy, setSortBy] = useState<SortOption>(savedResume ? 'best-match' : 'recently-discovered')

  const pageRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef(false)
  const resumeSkillsRef = useRef(resumeSkills)
  resumeSkillsRef.current = resumeSkills
  useStickyOffsets(pageRef, controlsRef)

  const activeFilters = useMemo(() => filtersKey(filters), [filters])
  const skillKey = resumeSkills.join('\u0001')
  const hasCriteria = query.trim().length > 0 || Object.values(filters).some((values) => values.size > 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  useEffect(() => {
    if (!query) {
      setDebouncedQuery('')
      return
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const controller = new AbortController()

    async function loadInsights() {
      try {
        setInsightsLoading(true)
        const result = await fetchMarketInsights()
        if (!controller.signal.aborted) setInsights(result)
      } catch {
        if (!controller.signal.aborted) setInsights(null)
      } finally {
        if (!controller.signal.aborted) setInsightsLoading(false)
      }
    }

    void loadInsights()
    return () => controller.abort()
  }, [loadKey])

  useEffect(() => {
    if (query !== debouncedQuery) return
    const controller = new AbortController()

    async function loadJobs() {
      try {
        setIsJobsLoading(true)
        setError('')
        const result = await fetchJobs({
          page,
          pageSize: JOB_PAGE_SIZE,
          query: debouncedQuery,
          sort: sortBy,
          cities: selected(filters, 'city'),
          styles: selected(filters, 'style'),
          experience: selected(filters, 'experience'),
          salaries: selected(filters, 'salary'),
          types: selected(filters, 'type'),
          dates: selected(filters, 'date'),
          skills: resumeSkillsRef.current,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setJobs(result.items)
        setTotal(result.total)
        setPageSize(result.pageSize)
        setCities(result.cities)
        if (result.page !== page) setPage(result.page)
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Failed to load jobs.')
        }
      } finally {
        if (!controller.signal.aborted) setIsJobsLoading(false)
      }
    }

    void loadJobs()
    return () => controller.abort()
  }, [debouncedQuery, query, activeFilters, sortBy, page, loadKey, skillKey, filters])

  useEffect(() => {
    if (!pendingScroll.current || isJobsLoading) return
    pendingScroll.current = false
    document.getElementById('job-results')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [jobs, isJobsLoading])

  const showSkeleton = isJobsLoading && jobs.length === 0 && !error

  function goToPage(next: number) {
    pendingScroll.current = true
    setPage(next)
  }

  return (
    <div className="page" ref={pageRef}>
      <div className={styles.controls} ref={controlsRef}>
        <div className={styles.searchWrap}>
          <div className={styles.searchBar}>
            <IconSearch />
            <input
              type="text"
              placeholder="Search by title, company, or skill..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              className={styles.searchInput}
            />
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ height: '58px', minWidth: '136px' }}
            onClick={() => document.getElementById('job-results')?.scrollIntoView({ behavior: 'smooth' })}
          >
            View {total}
          </button>
        </div>

        <FilterBar
          filters={filters}
          onChange={(next) => {
            setFilters(next)
            setPage(1)
          }}
          resultCount={total}
          cityOptions={cities}
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.rail}>
          <MarketSidebar insights={insights} isLoading={insightsLoading} />
        </div>

        <section className={styles.jobsSection} id="job-results" aria-busy={isJobsLoading}>
          <div className={styles.jobsSectionHeader}>
            <div>
              <h1 className={styles.jobsTitle}>{savedResume && sortBy === 'best-match' ? 'Top Matches' : 'Live Opportunities'}</h1>
              <p className={styles.jobsSubtitle}>
                {savedResume
                  ? 'Use truthful resume overlap, posting dates, and discovery freshness to prioritize your search.'
                  : 'Sorted by when HireSense discovered each role. Upload a resume to add skill matching.'}
              </p>
            </div>
            <label className={styles.sortControl}>
              <span>Sort by</span>
              <select
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as SortOption)
                  setPage(1)
                }}
              >
                <option value="best-match" disabled={!savedResume}>Best Match</option>
                <option value="newest-posted">Newest Posted</option>
                <option value="recently-discovered">Recently Discovered</option>
                <option value="company">Company</option>
                <option value="location">Location</option>
              </select>
            </label>
          </div>

          <div className={styles.jobsList}>
            {showSkeleton ? (
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
            ) : jobs.length > 0 ? (
              jobs.map((job) => <JobCard key={job.id} job={job} showMatch={Boolean(savedResume)} />)
            ) : hasCriteria ? (
              <div className={styles.emptyState}>
                <strong>No roles match those filters.</strong>
                <p>Clear a filter or broaden your search to see more of the live feed.</p>
                <button type="button" className="btn-outline" onClick={() => { setQuery(''); setFilters(buildEmptyFilters()); setPage(1) }}>
                  Reset search
                </button>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <strong>The live feed is between refreshes.</strong>
                <p>No qualifying DFW or explicit U.S.-remote roles are available right now.</p>
                <button type="button" className="btn-outline" onClick={() => setLoadKey((key) => key + 1)}>Refresh feed</button>
              </div>
            )}
          </div>

          {!error && total > 0 && (
            <div className={styles.pager}>
              <p className={styles.pagerStatus}>
                Showing {rangeStart}–{rangeEnd} of {total}
              </p>
              {totalPages > 1 && (
                <nav className={styles.pagerControls} aria-label="Job pages">
                  <button type="button" className={styles.pageButton} onClick={() => goToPage(page - 1)} disabled={page <= 1 || isJobsLoading}>
                    Previous
                  </button>
                  {pageTokens(page, totalPages).map((token, index) =>
                    token === 'gap' ? (
                      <span key={`gap-${index}`} className={styles.pageGap} aria-hidden="true">…</span>
                    ) : (
                      <button
                        key={token}
                        type="button"
                        className={styles.pageButton}
                        aria-current={token === page ? 'page' : undefined}
                        onClick={() => goToPage(token)}
                        disabled={isJobsLoading}
                      >
                        {token}
                      </button>
                    )
                  )}
                  <button type="button" className={styles.pageButton} onClick={() => goToPage(page + 1)} disabled={page >= totalPages || isJobsLoading}>
                    Next
                  </button>
                </nav>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
