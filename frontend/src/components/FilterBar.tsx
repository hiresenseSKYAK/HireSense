import { useState, useEffect, useRef } from 'react'
import { DATE_FILTER_OPTIONS, SALARY_FILTER_OPTIONS } from '../utils/jobFilters'
import styles from './FilterBar.module.css'

export const FILTER_DEFINITIONS = [
  {
    id: 'city',
    label: 'City',
    options: [] as string[],
  },
  {
    id: 'style',
    label: 'Work style',
    options: ['Remote','Hybrid','On-site'],
  },
  {
    id: 'experience',
    label: 'Experience',
    options: ['Internship', 'Entry level'],
  },
  {
    id: 'salary',
    label: 'Salary',
    options: [...SALARY_FILTER_OPTIONS],
  },
  {
    id: 'type',
    label: 'Job type',
    options: ['Full-time','Part-time','Contract','Internship'],
  },
  {
    id: 'date',
    label: 'Date posted',
    options: [...DATE_FILTER_OPTIONS],
  },
]

export type FilterState = Record<string, Set<string>>

interface Props {
  filters: FilterState
  onChange: (filters: FilterState) => void
  resultCount: number
  cityOptions?: string[]
}

export function buildEmptyFilters(): FilterState {
  return Object.fromEntries(FILTER_DEFINITIONS.map((f) => [f.id, new Set<string>()]))
}

export default function FilterBar({
  filters,
  onChange,
  resultCount,
  cityOptions = [],
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const definitions = FILTER_DEFINITIONS.map((filter) =>
    filter.id === 'city' ? { ...filter, options: cityOptions } : filter
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id))

  const check = (filterId: string, value: string, checked: boolean) => {
    const next = { ...filters }
    const set = new Set(next[filterId])
    if (checked) set.add(value)
    else set.delete(value)
    next[filterId] = set
    onChange(next)
  }

  const removePill = (filterId: string, value: string) => {
    const next = { ...filters }
    const set = new Set(next[filterId])
    set.delete(value)
    next[filterId] = set
    onChange(next)
  }

  const clearAll = () => onChange(buildEmptyFilters())

  const totalSelected = definitions.reduce(
    (n, f) => n + (filters[f.id]?.size ?? 0), 0
  )

  const pills = definitions.flatMap((f) =>
    [...(filters[f.id] ?? [])].map((val) => ({ filterId: f.id, val }))
  )

  return (
    <div className={styles.wrap} ref={barRef}>
      <div className={styles.topRow}>
        {definitions.map((f, i) => {
          const count = filters[f.id]?.size ?? 0
          const isOpen = openId === f.id
          return (
            <div key={f.id} className={styles.filterGroup}>
              {i > 0 && <div className={styles.dividerV} />}
              <div className={styles.filterBtn}>
                <button
                  type="button"
                  className={`${styles.btn} ${count > 0 ? styles.active : ''}`}
                  onClick={() => toggle(f.id)}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                >
                  {f.label}
                  {count > 0 && <span className={styles.countBadge}>{count}</span>}
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {isOpen && (
                  <div className={styles.dropdown}>
                    {f.options.length === 0 ? (
                      <div className={styles.dropdownEmpty}>No options yet</div>
                    ) : (
                      f.options.map((opt) => (
                        <label key={opt} className={styles.dropdownItem}>
                          <input
                            type="checkbox"
                            checked={filters[f.id]?.has(opt) ?? false}
                            onChange={(e) => check(f.id, opt, e.target.checked)}
                          />
                          {opt}
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {totalSelected > 0 && (
          <button type="button" className={styles.clearBtn} onClick={clearAll}>
            Clear all
          </button>
        )}

        <span className={styles.resultsCount}>
          {resultCount} job{resultCount !== 1 ? 's' : ''} found
        </span>
      </div>

      {pills.length > 0 && (
        <div className={styles.pillsRow}>
          {pills.map(({ filterId, val }) => (
            <span key={filterId + val} className={styles.pill}>
              {val}
              <button
                type="button"
                className={styles.pillX}
                onClick={() => removePill(filterId, val)}
                aria-label={`Remove ${val} filter`}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
