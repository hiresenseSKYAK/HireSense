import { describe, expect, it } from 'vitest'
import {
  confirmProfileReview,
  initializeApplicantProfile,
  initializeProfileReviewState,
  isProfileReviewConfirmed,
  isValidEmail,
  isValidGitHubUrl,
  isValidLinkedInUrl,
  isValidPhone,
  isValidPortfolioUrl,
  updateProfileValue,
  validateApplicantProfile,
} from './profile'

describe('profile initialization', () => {
  it('copies only supported resume values and trims them', () => {
    const resume = {
      filename: ' resume.pdf ',
      parsed_data: {
        name: '  Ada Lovelace  ',
        email: ' ada@example.com ',
        phone: ' +1 (555) 123-4567 ',
        skills: ['mathematics'],
      },
      raw_text: 'resume text',
    }

    expect(initializeApplicantProfile({
      parsed_data: {
        education: ['University of Texas'],
        experience_entries: [{ title: 'Intern at HireSense', bullets: ['Built a parser'] }],
        skills: ['Python'],
      },
    }).school).toBe('University of Texas')

    const prepared = initializeApplicantProfile({
      parsed_data: { name: 'Ada' },
      applicant_profile: {
        skills: ['SQL'],
        education: [{ school: 'Rice', degree: 'B.S.', fieldOfStudy: 'CS', startDate: '2022-08-01', endDate: '2026-05-31', current: false }],
        experience: [{ company: 'Acme', title: 'Analyst', location: 'Dallas', startDate: '2025-01-06', endDate: '2025-05-02', description: 'Reports', current: true }],
      },
    })
    expect(prepared.skillList).toEqual(['SQL'])
    expect(prepared.skills).toBe('SQL')
    expect(prepared.educationStart).toBe('2022-08-01')
    expect(prepared.educationEnd).toBe('2026-05-31')
    expect(prepared.company).toBe('Acme')
    expect(prepared.jobTitle).toBe('Analyst')
    expect(prepared.employmentEnd).toBe('Present')
    expect(prepared.experience[0].endDate).toBe('')

    expect(initializeApplicantProfile(resume)).toEqual({
      fullName: 'Ada Lovelace',
      firstName: '',
      lastName: '',
      email: 'ada@example.com',
      phone: '+1 (555) 123-4567',
      city: '',
      state: '',
      country: '', addressLine1: '', addressLine2: '', postalCode: '',
      linkedin: '',
      github: '',
      portfolio: '',
      skills: 'mathematics',
      skillList: ['mathematics'],
      school: '',
      degree: '',
      fieldOfStudy: '',
      educationStart: '',
      educationEnd: '',
      company: '',
      jobTitle: '',
      workLocation: '',
      employmentStart: '',
      employmentEnd: '',
      education: [],
      experience: [],
    })
  })

  it('does not mutate the resume object', () => {
    const resume = {
      filename: 'resume.pdf',
      parsed_data: {
        name: '  Grace Hopper  ',
        email: ' grace@example.com ',
        phone: ' 555-123-4567 ',
      },
    }
    const original = structuredClone(resume)

    initializeApplicantProfile(resume)

    expect(resume).toEqual(original)
  })

  it('handles missing parsed values', () => {
    expect(initializeApplicantProfile({ parsed_data: {} })).toEqual({
      fullName: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      country: '', addressLine1: '', addressLine2: '', postalCode: '',
      linkedin: '',
      github: '',
      portfolio: '',
      skills: '',
      skillList: [],
      school: '',
      degree: '',
      fieldOfStudy: '',
      educationStart: '',
      educationEnd: '',
      company: '',
      jobTitle: '',
      workLocation: '',
      employmentStart: '',
      employmentEnd: '',
      education: [],
      experience: [],
    })
  })

  it.each([
    undefined,
    null,
    'older stored value',
    [],
    {},
    { parsed_data: null },
    { parsed_data: { name: ['not', 'a', 'name'], email: 42 } },
  ])('does not crash for malformed or older stored data: %j', (source) => {
    expect(() => initializeApplicantProfile(source)).not.toThrow()
    expect(initializeApplicantProfile(source)).toEqual({
      fullName: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      country: '', addressLine1: '', addressLine2: '', postalCode: '',
      linkedin: '',
      github: '',
      portfolio: '',
      skills: '',
      skillList: [],
      school: '',
      degree: '',
      fieldOfStudy: '',
      educationStart: '',
      educationEnd: '',
      company: '',
      jobTitle: '',
      workLocation: '',
      employmentStart: '',
      employmentEnd: '',
      education: [],
      experience: [],
    })
  })
})

describe('profile validation', () => {
  it.each(['ada@example.com', 'first.last+tag@sub.example.org'])(
    'accepts valid email %s',
    (value) => expect(isValidEmail(value)).toBe(true),
  )

  it.each(['ada@', '@example.com', 'ada example.com', 'ada@example'])(
    'rejects invalid email %s',
    (value) => expect(isValidEmail(value)).toBe(false),
  )

  it.each(['555-123-4567', '+1 (555) 123-4567', '020 7946 0958'])(
    'accepts valid phone %s',
    (value) => expect(isValidPhone(value)).toBe(true),
  )

  it.each(['12345', 'call-me-now', '++1 555 123 4567', '(555 123-4567'])(
    'rejects invalid phone %s',
    (value) => expect(isValidPhone(value)).toBe(false),
  )

  it.each([
    'https://linkedin.com/in/ada-lovelace',
    'https://www.linkedin.com/in/ada-lovelace/',
  ])('accepts valid LinkedIn URL %s', (value) => {
    expect(isValidLinkedInUrl(value)).toBe(true)
  })

  it.each([
    'http://linkedin.com/in/ada-lovelace',
    'https://linkedin.com/company/example',
    'https://notlinkedin.com/in/ada-lovelace',
    'linkedin.com/in/ada-lovelace',
  ])('rejects invalid LinkedIn URL %s', (value) => {
    expect(isValidLinkedInUrl(value)).toBe(false)
  })

  it.each(['https://github.com/adalovelace', 'https://www.github.com/grace'])(
    'accepts valid GitHub URL %s',
    (value) => expect(isValidGitHubUrl(value)).toBe(true),
  )

  it.each([
    'http://github.com/adalovelace',
    'https://github.com/',
    'https://github.com/user/repository',
    'https://notgithub.com/adalovelace',
  ])('rejects invalid GitHub URL %s', (value) => {
    expect(isValidGitHubUrl(value)).toBe(false)
  })

  it.each([
    'https://example.com',
    'https://portfolio.example.com/work?view=all',
  ])('accepts valid portfolio URL %s', (value) => {
    expect(isValidPortfolioUrl(value)).toBe(true)
  })

  it.each(['http://example.com', 'example.com', 'not a url'])(
    'rejects invalid portfolio URL %s',
    (value) => expect(isValidPortfolioUrl(value)).toBe(false),
  )

  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/a'])(
    'rejects unsafe URL scheme %s',
    (value) => {
      expect(isValidLinkedInUrl(value)).toBe(false)
      expect(isValidGitHubUrl(value)).toBe(false)
      expect(isValidPortfolioUrl(value)).toBe(false)
    },
  )

  it('accepts blank optional fields', () => {
    const profile = initializeApplicantProfile(undefined)

    expect(isValidEmail('')).toBe(true)
    expect(isValidPhone('  ')).toBe(true)
    expect(isValidLinkedInUrl('')).toBe(true)
    expect(isValidGitHubUrl(' ')).toBe(true)
    expect(isValidPortfolioUrl('')).toBe(true)
    expect(validateApplicantProfile(profile)).toEqual({})
  })
})

describe('profile review revisions', () => {
  it('invalidates confirmation when a confirmed profile is edited', () => {
    const initial = initializeProfileReviewState({
      filename: ' resume.pdf ',
      parsed_data: { name: 'Ada Lovelace' },
    })
    const confirmed = confirmProfileReview(initial)

    expect(confirmed.sourceFilename).toBe('resume.pdf')
    expect(isProfileReviewConfirmed(confirmed)).toBe(true)

    const edited = updateProfileValue(confirmed, 'email', ' ada@example.com ')

    expect(edited.values.email).toBe('ada@example.com')
    expect(edited.revision).toBe(confirmed.revision + 1)
    expect(edited.confirmedRevision).toBeNull()
    expect(isProfileReviewConfirmed(edited)).toBe(false)
    expect(confirmed.values.email).toBe('')
  })

  it('preserves the state and confirmation when a value does not change', () => {
    const confirmed = confirmProfileReview(
      initializeProfileReviewState({
        parsed_data: { email: 'ada@example.com' },
      }),
    )

    const unchanged = updateProfileValue(
      confirmed,
      'email',
      ' ada@example.com ',
    )

    expect(unchanged).toBe(confirmed)
    expect(isProfileReviewConfirmed(unchanged)).toBe(true)
  })
})
