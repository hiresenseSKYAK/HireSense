// Remembers the job list's search, filters, and page for this tab so the "Jobs" link
// in the navigation bar returns to the same list. The logo still goes to "/" (a fresh list).
const JOB_LIST_SEARCH_KEY = 'hiresense_job_list_search'

export function rememberJobListSearch(search: string): void {
  try { sessionStorage.setItem(JOB_LIST_SEARCH_KEY, search) } catch { /* Optional list memory. */ }
}

export function jobListHref(): string {
  try {
    const search = sessionStorage.getItem(JOB_LIST_SEARCH_KEY) ?? ''
    return search.startsWith('?') ? `/${search}` : '/'
  } catch {
    return '/'
  }
}
