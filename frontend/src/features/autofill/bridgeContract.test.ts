import { describe, expect, it } from 'vitest'
import manifest from '../../../extension/static/manifest.json'
import { allowedOrigins, allowedSender, profileExpired, PROFILE_TTL_MS, transferableProfile } from './bridgeContract'
import { initializeApplicantProfile } from './core/profile'

describe('extension privacy and origin contract', () => {
  const profile = { ...initializeApplicantProfile(null), fullName: 'Ada Lovelace', email: 'ada@example.com' }
  it('copies only the fourteen approved applicant fields', () => {
    const payload = { ...profile, token: 'must not transfer', resumeText: 'must not transfer', file: 'private.pdf' }
    expect(transferableProfile(payload)).toEqual(profile)
    expect(transferableProfile(payload)).not.toBe(payload)
  })
  it.each([null, [], {}, { email: 'ada@example.com' }, { ...profile, phone: 123 }, { ...profile, email: 'invalid' }, initializeApplicantProfile(null)])('rejects malformed, incomplete, empty or invalid payloads', (value) => {
    expect(transferableProfile(value)).toBeNull()
  })
  it('rejects oversized data', () => expect(transferableProfile({ ...profile, fullName: 'a'.repeat(2049) })).toBeNull())
  it('allows only the exact production and intentional development origins', () => {
    expect(allowedSender('https://hiresense-9yub.onrender.com/application/prepare')).toBe(true)
    expect(allowedSender('http://localhost:5173/application/prepare')).toBe(true)
    for (const url of ['https://hiresense-9yub.onrender.com.evil.test', 'http://hiresense-9yub.onrender.com', 'https://evil.test', undefined]) expect(allowedSender(url)).toBe(false)
    expect(manifest.externally_connectable.matches).toEqual(allowedOrigins.map((origin) => origin + '/*').reverse())
  })
  it('expires at 30 minutes and rejects invalid expiry values', () => {
    expect(PROFILE_TTL_MS).toBe(1800000)
    expect(profileExpired(1001, 1000)).toBe(false)
    expect(profileExpired(1000, 1000)).toBe(true)
    expect(profileExpired(undefined)).toBe(true)
    expect(profileExpired(NaN)).toBe(true)
  })
})
