import type { ApplicantProfile } from './core/types'
import { initializeApplicantProfile, validateApplicantProfile } from './core/profile'
import { hasApplicantValue, isApplicantProfile } from './review'

export const PROFILE_TTL_MS = 30 * 60 * 1000
export const allowedOrigins = ['https://hiresense-9yub.onrender.com', 'http://localhost:5173']

export function allowedSender(url: string | undefined): boolean {
  try { return Boolean(url && allowedOrigins.includes(new URL(url).origin)) } catch { return false }
}

// Copy an explicit allowlist. Even a caller with extra properties cannot transfer them.
export function transferableProfile(value: unknown): ApplicantProfile | null {
  if (!isApplicantProfile(value)) return null
  const profile = initializeApplicantProfile(null)
  for (const key of Object.keys(profile) as Array<keyof ApplicantProfile>) {
    if (value[key].length > 2048) return null
    profile[key] = value[key].trim()
  }
  return hasApplicantValue(profile) && !Object.keys(validateApplicantProfile(profile)).length ? profile : null
}

export function profileExpired(expiresAt: unknown, now = Date.now()): boolean {
  return typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now
}
