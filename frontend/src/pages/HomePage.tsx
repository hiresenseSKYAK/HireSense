import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import JobCard from '../components/JobCard'
import MarketSidebar from '../components/MarketSidebar'
import FilterBar, { buildEmptyFilters, FILTER_DEFINITIONS, type FilterState } from '../components/FilterBar'
import { IconSearch } from '../components/Icons'
import { fetchJobs, fetchMarketInsights, JOB_PAGE_SIZE, type MarketInsightsResponse } from '../api/jobs'
import { getJobRecommendations, type JobRecommendationsResult } from '../api/career'
import { getAuthSession } from '../api/auth'
import { formatPostedDate, isNewSinceVisit, sourcePostedAt } from '../utils/jobFreshness'
import { getResumeAnalysis } from '../utils/resumeStorage'
import type { Job } from '../types'
import styles from './HomePage.module.css'

type SortOption = 'best-match' | 'newest-posted' | 'recently-discovered' | 'company' | 'location'
type GeoScope = 'dfw' | 'remote' | 'texas' | 'nationwide'

const SORT_OPTIONS: readonly SortOption[] = ['best-match', 'newest-posted', 'recently-discovered', 'company', 'location']
const FILTER_IDS = FILTER_DEFINITIONS.map((filter) => filter.id)
// Remembers where the user was in the list so "Back to Jobs" lands on the same card.
const HOME_SCROLL_KEY = 'hiresense_home_scroll'

function isSortOption(value: string | null): value is SortOption {
  return value !== null && (SORT_OPTIONS as readonly string[]).includes(value)
}

// The URL is the source of truth for search, filters, sort, and page so that
// leaving for a job detail and coming back (or refreshing) restores the list.
function readFilters(params: URLSearchParams): FilterState {
  const filters = buildEmptyFilters()
  for (const id of Object.keys(filters)) {
    for (const value of params.getAll(id)) {
      if (value.trim()) filters[id].add(value)
    }
  }
  return filters
}

function readPage(params: URLSearchParams): number {
  const value = Number.parseInt(params.get('page') ?? '', 10)
  return Number.isFinite(value) && value > 1 ? value : 1
}

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
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const filters = useMemo(() => readFilters(searchParams), [searchParams])
  const page = readPage(searchParams)
  const useResume = Boolean(savedResume) && searchParams.get('resume') !== 'off'
  const sortParam = searchParams.get('sort')
  const sortBy: SortOption = isSortOption(sortParam) && (sortParam !== 'best-match' || savedResume)
    ? sortParam
    : useResume ? 'best-match' : 'recently-discovered'
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(JOB_PAGE_SIZE)
  const [cities, setCities] = useState<string[]>([])
  const [insights, setInsights] = useState<MarketInsightsResponse | null>(null)
  const [isJobsLoading, setIsJobsLoading] = useState(true)
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const geoKey = `hiresense_geo_scope_${getAuthSession()?.user.id ?? 'guest'}`
  const [geoScope, setGeoScope] = useState<GeoScope>(() => {
    try {
      const saved = localStorage.getItem(geoKey)
      return saved === 'remote' || saved === 'texas' || saved === 'nationwide' ? saved : 'dfw'
    } catch { return 'dfw' }
  })
  const [recommendations, setRecommendations] = useState<JobRecommendationsResult | null>(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const visitKey = `hiresense_job_feed_last_visit_${getAuthSession()?.user.id ?? 'guest'}`
  const previousVisitAt = useRef<string | null | undefined>(undefined)
  if (previousVisitAt.current === undefined) {
    try { previousVisitAt.current = localStorage.getItem(visitKey) }
    catch { previousVisitAt.current = null }
  }

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

  const lastWrittenQuery = useRef(urlQuery)
  const listUrl = `${location.pathname}${location.search}`

  // Every list-state change replaces the current history entry, so the browser
  // Back button leaves the job list instead of undoing filter clicks one by one.
  const updateParams = useCallback((apply: (next: URLSearchParams) => void) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      apply(next)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setPage = useCallback((next: number) => {
    updateParams((params) => {
      if (next > 1) params.set('page', String(next))
      else params.delete('page')
    })
  }, [updateParams])

  function setFilters(next: FilterState) {
    updateParams((params) => {
      for (const id of FILTER_IDS) params.delete(id)
      for (const id of FILTER_IDS) {
        for (const value of [...(next[id] ?? [])].sort()) params.append(id, value)
      }
      params.delete('page')
    })
  }

  function setSortBy(next: SortOption) {
    updateParams((params) => {
      params.set('sort', next)
      params.delete('page')
    })
  }

  function setUseResume(enabled: boolean) {
    updateParams((params) => {
      if (enabled) params.delete('resume')
      else params.set('resume', 'off')
      params.delete('sort')
      params.delete('page')
    })
  }

  function resetSearch() {
    setQuery('')
    lastWrittenQuery.current = ''
    updateParams((params) => {
      params.delete('q')
      for (const id of FILTER_IDS) params.delete(id)
      params.delete('page')
    })
  }

  // Keep the search box in sync when the URL changes from outside this page
  // (Back/Forward, or clicking the HireSense logo to reset the list).
  useEffect(() => {
    if (urlQuery === lastWrittenQuery.current) return
    lastWrittenQuery.current = urlQuery
    setQuery(urlQuery)
  }, [urlQuery])

  useEffect(() => {
    if (query === urlQuery) return
    const timer = window.setTimeout(() => {
      lastWrittenQuery.current = query
      updateParams((params) => {
        if (query) params.set('q', query)
        else params.delete('q')
        params.delete('page')
      })
    }, query ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [query, urlQuery, updateParams])

  // Scroll restoration: remember the list position whenever the user clicks
  // inside the page (e.g. on a job), and restore it once the same list reloads.
  const restoreScrollY = useRef<number | null | undefined>(undefined)
  if (restoreScrollY.current === undefined) {
    restoreScrollY.current = null
    try {
      const saved = JSON.parse(sessionStorage.getItem(HOME_SCROLL_KEY) ?? 'null') as { search?: string; y?: number } | null
      if (saved && saved.search === location.search && typeof saved.y === 'number') restoreScrollY.current = saved.y
    } catch { /* Optional scroll memory. */ }
  }

  function rememberScroll() {
    try {
      sessionStorage.setItem(HOME_SCROLL_KEY, JSON.stringify({ search: location.search, y: window.scrollY }))
    } catch { /* Optional scroll memory. */ }
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadInsights() {
      try {
        setInsightsLoading(true)
        const result = await fetchMarketInsights(controller.signal)
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
    const controller = new AbortController()

    async function loadJobs() {
      try {
        setIsJobsLoading(true)
        setError('')
        const result = await fetchJobs({
          page,
          pageSize: JOB_PAGE_SIZE,
          query: urlQuery,
          sort: sortBy,
          geo: geoScope,
          cities: selected(filters, 'city'),
          styles: selected(filters, 'style'),
          experience: selected(filters, 'experience'),
          salaries: selected(filters, 'salary'),
          types: selected(filters, 'type'),
          dates: selected(filters, 'date'),
          skills: useResume ? resumeSkillsRef.current : [],
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setJobs(result.items)
        setTotal(result.total)
        setPageSize(result.pageSize)
        setCities(result.cities)
        try { localStorage.setItem(visitKey, new Date().toISOString()) } catch { /* Optional visit marker. */ }
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
  }, [urlQuery, activeFilters, sortBy, geoScope, page, loadKey, skillKey, filters, useResume, setPage])

  useEffect(() => {
    if (isJobsLoading || restoreScrollY.current === null || restoreScrollY.current === undefined) return
    const y = restoreScrollY.current
    restoreScrollY.current = null
    try { sessionStorage.removeItem(HOME_SCROLL_KEY) } catch { /* Optional scroll memory. */ }
    window.requestAnimationFrame?.(() => window.scrollTo?.(0, y))
  }, [jobs, isJobsLoading])

  useEffect(() => {
    if (!pendingScroll.current || isJobsLoading) return
    pendingScroll.current = false
    document.getElementById('job-results')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [jobs, isJobsLoading])

  useEffect(() => {
    if (!useResume || !savedResume || !getAuthSession()?.token) {
      setRecommendations(null)
      return
    }
    let active = true
    setRecommendationLoading(true)
    void getJobRecommendations(savedResume.parsed_data).then((result) => {
      if (!active) return
      setRecommendations(result)
    }).catch(() => { if (active) setRecommendations(null) })
      .finally(() => { if (active) setRecommendationLoading(false) })
    return () => { active = false }
  }, [useResume, skillKey, loadKey])

  const showSkeleton = isJobsLoading && jobs.length === 0 && !error
  const newMatchCount = recommendations?.items.filter((job) => isNewSinceVisit(job.firstSeenAt, previousVisitAt.current)).length ?? 0
  const newOnPage = jobs.filter((job) => isNewSinceVisit(job.firstSeenAt, previousVisitAt.current)).slice(0, 3)

  function goToPage(next: number) {
    pendingScroll.current = true
    setPage(next)
  }

  return (
    <div
      className={`page ${styles.home}`}
      ref={pageRef}
      onClickCapture={rememberScroll}
      onKeyDownCapture={(event) => { if (event.key === 'Enter' || event.key === ' ') rememberScroll() }}
    >
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
            View {total}
          </button>
        </div>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          resultCount={total}
          cityOptions={cities}
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.rail}>
          <MarketSidebar insights={insights} isLoading={insightsLoading} />
        </div>

        <section className={styles.jobsSection} id="job-results" aria-busy={isJobsLoading}>
          {savedResume && <label className={styles.resumeToggle}>
            <input type="checkbox" checked={useResume} onChange={(event) => {
              setUseResume(event.target.checked)
            }} />
            <span>Use my resume</span><small>Prioritize roles using your saved skills; filters still apply.</small>
          </label>}
          {useResume && recommendations && recommendations.items.length > 0 && <section className={styles.recommended} aria-labelledby="recommended-title">
            <div className={styles.recommendedHeading}><div><span className={styles.recommendedEyebrow}>Your next opportunities</span><h2 id="recommended-title">Recommended for you</h2></div>{newMatchCount > 0 && <span className={styles.newMatches}>{newMatchCount} new since your last visit</span>}</div>
            <p>Ranked from your resume and current role details. These are preparation priorities, not hiring odds.</p>
            <div className={styles.recommendedList}>{recommendations.items.slice(0, 4).map((job) => <div key={job.id} className={styles.recommendedItem}>
              <div><span className={styles.priority}>{job.priority}</span><Link to={`/jobs/${job.id}`} state={{ from: listUrl }}><strong>{job.title}</strong></Link><small>{job.company} · {job.location}{formatPostedDate(sourcePostedAt(job)) ? ` · ${job.source === 'adzuna' ? 'Adzuna ad date' : 'Posted'} ${formatPostedDate(sourcePostedAt(job))}` : ''}</small>{job.source === 'adzuna' && <a href="https://www.adzuna.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', minWidth: 116, minHeight: 23 }}>Adzuna</a>}</div>
              <div className={styles.recommendedReason}><span>{job.whyThisFits}</span>{job.topGap && <small>Prepare: {job.topGap}</small>}{job.preparationNote && <small>{job.preparationNote}</small>}</div>
            </div>)}</div>
          </section>}
          {useResume && recommendationLoading && <p className={styles.recommendationLoading} role="status">Finding relevant roles from your resume…</p>}
          {newOnPage.length > 0 && <section className={styles.recommended} aria-labelledby="new-for-you-title">
            <div className={styles.recommendedHeading}><div><span className={styles.recommendedEyebrow}>Discovered since your previous visit</span><h2 id="new-for-you-title">New for you</h2></div></div>
            <div className={styles.recommendedList}>{newOnPage.map((job) => <div key={job.id} className={styles.recommendedItem}>
              <div><Link to={`/jobs/${job.id}`} state={{ from: listUrl }}><strong>{job.title}</strong></Link><small>{job.company} · {job.location}</small>{job.source === 'adzuna' && <a href="https://www.adzuna.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', minWidth: 116, minHeight: 23 }}>Adzuna</a>}</div>
              <small>New to HireSense</small>
            </div>)}</div>
          </section>}
          <div className={styles.jobsSectionHeader}>
            <div>
              <h1 className={styles.jobsTitle}>{savedResume && sortBy === 'best-match' ? 'Top Matches' : 'Live Opportunities'}</h1>
              <p className={styles.jobsSubtitle}>
                {savedResume
                  ? 'Use truthful resume overlap, posting dates, and discovery freshness to prioritize your search.'
                  : 'Sorted by when HireSense discovered each role. Upload a resume to add skill matching.'}
              </p>
            </div>
            <div className={styles.listControls}>
            <label className={styles.sortControl}>
              <span>Location scope</span>
              <select value={geoScope} onChange={(event) => {
                const next = event.target.value as GeoScope
                setGeoScope(next)
                setPage(1)
                try { localStorage.setItem(geoKey, next) } catch { /* Optional preference. */ }
              }}>
                <option value="dfw">Dallas / DFW + US remote</option>
                <option value="remote">Remote only</option>
                <option value="texas">Texas + US remote</option>
                <option value="nationwide">Nationwide</option>
              </select>
            </label>
            <label className={styles.sortControl}>
              <span>Sort by</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortOption)}
              >
                <option value="best-match" disabled={!savedResume}>Best Match</option>
                <option value="newest-posted">Newest Posted</option>
                <option value="recently-discovered">Recently Discovered</option>
                <option value="company">Company</option>
                <option value="location">Location</option>
              </select>
            </label>
            </div>
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
                <button type="button" className="btn-outline" onClick={resetSearch}>
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
