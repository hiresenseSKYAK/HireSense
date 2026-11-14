import type { ApplicantProfile } from './core/types'
import { initializeApplicantProfile, LEGACY_MAX_PROFILE_ENTRIES, LEGACY_MAX_SKILLS, MAX_PROFILE_ENTRIES, MAX_SKILLS, mirrorPrimaryEntries, normalizeIsoDate, validateApplicantProfile } from './core/profile'
import { hasApplicantValue, isApplicantProfile } from './review'

export const BRIDGE_PROTOCOL_VERSION = 1
export const PROFILE_TTL_MS = 24 * 60 * 60 * 1000
// First extension version that accepts MAX_SKILLS skills and MAX_PROFILE_ENTRIES schools/jobs.
export const LARGE_PROFILE_EXTENSION_VERSION = '0.5.0'

/** Compare dotted versions such as "0.4.0". Unreadable versions count as old. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (text: string) => text.split('.').map((part) => Number.parseInt(part, 10))
  const have = parse(version)
  const need = parse(minimum)
  if (have.some((part) => !Number.isFinite(part))) return false
  for (let index = 0; index < need.length; index += 1) {
    const a = have[index] ?? 0
    if (a !== need[index]) return a > need[index]
  }
  return true
}

/**
 * Older installed extensions reject profiles above 20 skills or 4 schools/jobs.
 * Trim to what that extension accepts instead of failing the whole sync.
 */
export function fitProfileForExtension(profile: ApplicantProfile, extensionVersion: string): { profile: ApplicantProfile; limited: boolean } {
  if (versionAtLeast(extensionVersion, LARGE_PROFILE_EXTENSION_VERSION)) return { profile, limited: false }
  const limited = profile.skillList.length > LEGACY_MAX_SKILLS
    || profile.education.length > LEGACY_MAX_PROFILE_ENTRIES
    || profile.experience.length > LEGACY_MAX_PROFILE_ENTRIES
  if (!limited) return { profile, limited: false }
  return {
    profile: mirrorPrimaryEntries({
      ...profile,
      skillList: profile.skillList.slice(0, LEGACY_MAX_SKILLS),
      education: profile.education.slice(0, LEGACY_MAX_PROFILE_ENTRIES),
      experience: profile.experience.slice(0, LEGACY_MAX_PROFILE_ENTRIES),
    }),
    limited: true,
  }
}
export const allowedOrigins = ['https://hiresense-9yub.onrender.com', 'http://localhost:5173']
export const BRIDGE_REQUEST_CHANNEL = 'hiresense-extension-request'
export const BRIDGE_RESPONSE_CHANNEL = 'hiresense-extension-response'
export const BRIDGE_READY_CHANNEL = 'hiresense-extension-ready'
export const BRIDGE_OPERATIONS = ['ping', 'set-confirmed-profile', 'clear-profile'] as const
export type BridgeOperation = typeof BRIDGE_OPERATIONS[number]
export const RUNTIME_BRIDGE_MESSAGES = {
  ping: 'site-bridge-ping',
  'set-confirmed-profile': 'site-bridge-profile',
  'clear-profile': 'site-bridge-clear',
} as const satisfies Record<BridgeOperation, string>

export type BridgeErrorCode =
  | 'extension_not_installed'
  | 'content_script_missing'
  | 'bridge_timeout'
  | 'protocol_mismatch'
  | 'background_rejected'
  | 'origin_rejected'
  | 'profile_validation_failed'
  | 'storage_failed'

export function isBridgeOperation(value: unknown): value is BridgeOperation {
  return typeof value === 'string' && (BRIDGE_OPERATIONS as readonly string[]).includes(value)
}

export function profileFingerprint(profile: ApplicantProfile): string {
  // A change marker, not an authentication secret.
  const value = JSON.stringify(profile)
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return (hash >>> 0).toString(36)
}

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
