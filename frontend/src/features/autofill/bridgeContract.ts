import type { ApplicantProfile } from './core/types'
import { initializeApplicantProfile, MAX_PROFILE_ENTRIES, MAX_SKILLS, mirrorPrimaryEntries, normalizeIsoDate, validateApplicantProfile } from './core/profile'
import { hasApplicantValue, isApplicantProfile } from './review'

export const PROFILE_TTL_MS = 30 * 60 * 1000
export const allowedOrigins = ['https://hiresense-9yub.onrender.com', 'http://localhost:5173']

export function allowedSender(url: string | undefined): boolean {
  try { return Boolean(url && allowedOrigins.includes(new URL(url).origin)) } catch { return false }
}

// Copy an explicit allowlist. Even a caller with extra properties cannot transfer them.
export function transferableProfile(value: unknown): ApplicantProfile | null {
  if (!isApplicantProfile(value)) return null
  if (value.education.length > MAX_PROFILE_ENTRIES || value.experience.length > MAX_PROFILE_ENTRIES || value.skillList.length > MAX_SKILLS) return null
  const profile = initializeApplicantProfile(null)
  for (const key of Object.keys(profile) as Array<keyof ApplicantProfile>) {
    const field = value[key]
    if (typeof field === 'string') {
      if (field.length > 2048) return null
      profile[key] = field.trim() as never
    }
  }
  const skillList: string[] = []
  for (const skill of value.skillList) {
    if (skill.length > 60) return null
    const trimmed = skill.trim()
    if (trimmed) skillList.push(trimmed)
  }
  profile.skillList = skillList
  const copyEntry = <T extends { current: boolean; startDate: string; endDate: string }>(entry: T): T | null => {
    const next = { ...entry, current: entry.current === true }
    for (const entryKey of Object.keys(next) as Array<keyof T>) {
      const field = next[entryKey]
      if (typeof field === 'boolean') continue
      if (typeof field !== 'string' || field.length > 2048) return null
      next[entryKey] = field.trim() as T[keyof T]
    }
    next.startDate = normalizeIsoDate(next.startDate)
    next.endDate = next.current ? '' : normalizeIsoDate(next.endDate)
    return next
  }
  const education = value.education.map(copyEntry)
  const experience = value.experience.map(copyEntry)
  if (education.some((entry) => entry === null) || experience.some((entry) => entry === null)) return null
  profile.education = education as ApplicantProfile['education']
  profile.experience = experience as ApplicantProfile['experience']
  const mirrored = mirrorPrimaryEntries(profile)
  return hasApplicantValue(mirrored) && !Object.keys(validateApplicantProfile(mirrored)).length ? mirrored : null
}

export function profileExpired(expiresAt: unknown, now = Date.now()): boolean {
  return typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now
}
