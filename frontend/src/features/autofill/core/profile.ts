import type { ResumeUploadResponse } from '../../../api/resume'
import type { ApplicantProfile, EducationEntry, ExperienceEntry, ProfileReviewState } from './types'

// Keep in step with MAX_ENTRIES and MAX_SKILLS in backend/services/applicant_profile.py.
export const MAX_PROFILE_ENTRIES = 6
export const MAX_SKILLS = 50
// Extensions older than 0.4.1 reject profiles above these sizes.
export const LEGACY_MAX_PROFILE_ENTRIES = 4
export const LEGACY_MAX_SKILLS = 20
// Applications with a single skills box receive this joined text.
const SKILLS_TEXT_LIMIT = 1000

/** Join skills with commas, stopping before a skill that would not fit (never cutting one in half). */
export function joinSkills(skills: string[], limit = SKILLS_TEXT_LIMIT): string {
  let text = ''
  for (const skill of skills.map((item) => item.trim()).filter(Boolean)) {
    const next = text ? `${text}, ${skill}` : skill
    if (next.length > limit) break
    text = next
  }
  return text
}

/** Number of distinct skills the resume lists, before any limit is applied. */
export function resumeSkillCount(source: unknown): number {
  const skills = isRecord(source) && isRecord(source.parsed_data) && Array.isArray(source.parsed_data.skills)
    ? source.parsed_data.skills
    : []
  return new Set(skills.map((skill) => trimmedString(skill).toLowerCase()).filter(Boolean)).size
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function normalizeIsoDate(value: unknown): string {
  const text = trimmedString(value)
  const match = ISO_DATE.exec(text)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return ''
  return text
}

export type ProfileValidationErrors = Partial<
  Record<keyof ApplicantProfile, string>
>

const EMPTY_PROFILE: ApplicantProfile = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  country: '',
  addressLine1: '',
  addressLine2: '',
  postalCode: '',
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
}

export function emptyEducationEntry(): EducationEntry {
  return { school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', current: false }
}

export function emptyExperienceEntry(): ExperienceEntry {
  return { company: '', title: '', location: '', startDate: '', endDate: '', description: '', current: false }
}

function splitExperienceTitle(title: string): { company: string; title: string } {
  const text = title.trim()
  const lower = text.toLowerCase()
  for (const marker of [' at ', ' @ ']) {
    const index = lower.lastIndexOf(marker)
    if (index > 0) {
      return { title: text.slice(0, index).trim(), company: text.slice(index + marker.length).trim() }
    }
  }
  for (const marker of [' | ', ' — ', ' – ', ' - ']) {
    const index = text.indexOf(marker)
    if (index > 0) {
      return { company: text.slice(0, index).trim(), title: text.slice(index + marker.length).trim() }
    }
  }
  return { company: '', title: text }
}

function datedEntry(record: Record<string, unknown>): { startDate: string; endDate: string; current: boolean } {
  const rawEnd = trimmedString(record.endDate)
  const current = record.current === true || /^present$/i.test(rawEnd)
  return {
    startDate: normalizeIsoDate(record.startDate),
    endDate: current ? '' : normalizeIsoDate(rawEnd),
    current,
  }
}

function hasEntryText(entry: object): boolean {
  return Object.entries(entry).some(([key, field]) => key !== 'current' && typeof field === 'string' && field !== '')
}

function educationFromSource(source: Record<string, unknown>): EducationEntry[] {
  const provided = Array.isArray(source.education) ? source.education : []
  if (provided.some((entry) => isRecord(entry))) {
    return provided.slice(0, MAX_PROFILE_ENTRIES).map((entry) => {
      const record = isRecord(entry) ? entry : {}
      return {
        school: trimmedString(record.school),
        degree: trimmedString(record.degree),
        fieldOfStudy: trimmedString(record.fieldOfStudy),
        ...datedEntry(record),
      }
    }).filter(hasEntryText)
  }

  return provided
    .map((line) => trimmedString(line))
    .filter(Boolean)
    .slice(0, MAX_PROFILE_ENTRIES)
    .map((school) => ({ ...emptyEducationEntry(), school }))
}

function experienceFromSource(source: Record<string, unknown>): ExperienceEntry[] {
  const provided = Array.isArray(source.experience) ? source.experience : []
  if (provided.some((entry) => isRecord(entry) && ('company' in entry || 'description' in entry))) {
    return provided.slice(0, MAX_PROFILE_ENTRIES).map((entry) => {
      const record = isRecord(entry) ? entry : {}
      return {
        company: trimmedString(record.company),
        title: trimmedString(record.title),
        location: trimmedString(record.location),
        description: trimmedString(record.description),
        ...datedEntry(record),
      }
    }).filter(hasEntryText)
  }

  const entries = Array.isArray(source.experience_entries) ? source.experience_entries : []
  return entries.slice(0, MAX_PROFILE_ENTRIES).map((entry) => {
    const record = isRecord(entry) ? entry : {}
    const split = splitExperienceTitle(trimmedString(record.title))
    const bullets = Array.isArray(record.bullets) ? record.bullets.map(trimmedString).filter(Boolean) : []
    return {
      ...emptyExperienceEntry(),
      company: split.company,
      title: split.title,
      description: bullets.join('\n').slice(0, 1000),
    }
  }).filter(hasEntryText)
}

function skillListFromSource(provided: Record<string, unknown>, parsed: Record<string, unknown>): string[] {
  const source = Array.isArray(provided.skills) || typeof provided.skills === 'string'
    ? provided.skills
    : Array.isArray(provided.skillList)
      ? provided.skillList
      : parsed.skills
  let raw: unknown[] = Array.isArray(source) ? source : typeof source === 'string' ? source.split(',') : []
  // Resumes saved before the limit was raised carry a 20-skill copy; the parsed list has all of them.
  if (Array.isArray(parsed.skills) && parsed.skills.length > raw.length) raw = parsed.skills
  const skills: string[] = []
  raw.forEach((skill) => {
    const cleaned = trimmedString(skill).slice(0, 60)
    if (cleaned && !skills.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      skills.push(cleaned)
    }
  })
  return skills.slice(0, MAX_SKILLS)
}

export function mirrorPrimaryEntries(profile: ApplicantProfile): ApplicantProfile {
  const education = profile.education[0]
  const experience = profile.experience[0]
  const skillList = profile.skillList.slice(0, MAX_SKILLS)
  return {
    ...profile,
    skillList,
    skills: joinSkills(skillList),
    school: education?.school ?? '',
    degree: education?.degree ?? '',
    fieldOfStudy: education?.fieldOfStudy ?? '',
    educationStart: education?.startDate ?? '',
    educationEnd: education?.current ? 'Present' : education?.endDate ?? '',
    company: experience?.company ?? '',
    jobTitle: experience?.title ?? '',
    workLocation: experience?.location ?? '',
    employmentStart: experience?.startDate ?? '',
    employmentEnd: experience?.current ? 'Present' : experience?.endDate ?? '',
  }
}

export function historyDateError(profile: ApplicantProfile): string | null {
  const education = profile.education.find((entry) => entry.startDate && entry.endDate && entry.endDate < entry.startDate)
  if (education) return 'An education end date must be on or after its start date.'
  const experience = profile.experience.find((entry) => entry.startDate && entry.endDate && entry.endDate < entry.startDate)
  if (experience) return 'A job end date must be on or after its start date.'
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parsedResumeData(source: unknown): Record<string, unknown> {
  if (!isRecord(source) || !isRecord(source.parsed_data)) {
    return {}
  }

  return source.parsed_data
}

function joinName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(' ')
}

// Older saved resumes only carry "name"; split it so first/last are still filled.
function resumeNames(parsedData: Record<string, unknown>): { firstName: string; lastName: string } {
  const firstName = trimmedString(parsedData.first_name)
  const lastName = trimmedString(parsedData.last_name)
  if (firstName || lastName) return { firstName, lastName }
  const words = trimmedString(parsedData.name).split(/\s+/).filter(Boolean)
  if (words.length === 0) return { firstName: '', lastName: '' }
  return { firstName: words[0], lastName: words.length > 1 ? words[words.length - 1] : '' }
}

export function initializeApplicantProfile(
  source: ResumeUploadResponse,
): ApplicantProfile
export function initializeApplicantProfile(source: unknown): ApplicantProfile
export function initializeApplicantProfile(source: unknown): ApplicantProfile {
  const parsedData = parsedResumeData(source)
  const provided = isRecord(source) && isRecord(source.applicant_profile) ? source.applicant_profile : {}
  const historySource = Object.keys(provided).length > 0 ? provided : parsedData

  const names = resumeNames(parsedData)

  return mirrorPrimaryEntries({
    ...EMPTY_PROFILE,
    ...names,
    fullName: joinName(names.firstName, names.lastName) || trimmedString(parsedData.name),
    city: trimmedString(parsedData.city),
    state: trimmedString(parsedData.state),
    linkedin: trimmedString(parsedData.linkedin),
    github: trimmedString(parsedData.github),
    email: trimmedString(parsedData.email),
    phone: trimmedString(parsedData.phone),
    skillList: skillListFromSource(provided, parsedData),
    education: educationFromSource(historySource),
    experience: experienceFromSource(historySource),
  })
}

export function initializeProfileReviewState(
  source: ResumeUploadResponse,
): ProfileReviewState
export function initializeProfileReviewState(source: unknown): ProfileReviewState
export function initializeProfileReviewState(
  source: unknown,
): ProfileReviewState {
  const sourceFilename = isRecord(source)
    ? trimmedString(source.filename)
    : ''

  return {
    values: initializeApplicantProfile(source),
    revision: 0,
    confirmedRevision: null,
    sourceFilename,
  }
}

export function isValidEmail(value: string): boolean {
  const email = value.trim()
  return email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isValidPhone(value: string): boolean {
  const phone = value.trim()
  if (phone === '') {
    return true
  }

  if (!/^\+?[0-9().\-\s]+$/.test(phone)) {
    return false
  }

  const openingParentheses = (phone.match(/\(/g) ?? []).length
  const closingParentheses = (phone.match(/\)/g) ?? []).length
  if (openingParentheses !== closingParentheses) {
    return false
  }

  const digitCount = (phone.match(/\d/g) ?? []).length
  return digitCount >= 7 && digitCount <= 15
}

function parseHttpsUrl(value: string): URL | null {
  const candidate = value.trim()
  if (candidate === '') {
    return null
  }

  try {
    const url = new URL(candidate)
    if (
      url.protocol !== 'https:' ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null
    }

    return url
  } catch {
    return null
  }
}

function hasSupportedHost(url: URL, host: string): boolean {
  return url.hostname === host || url.hostname === `www.${host}`
}

function hasSinglePathSegment(url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean)
  return segments.length === 1
}

export function isValidLinkedInUrl(value: string): boolean {
  if (value.trim() === '') {
    return true
  }

  const url = parseHttpsUrl(value)
  if (!url || !hasSupportedHost(url, 'linkedin.com')) {
    return false
  }

  const segments = url.pathname.split('/').filter(Boolean)
  return segments.length === 2 && segments[0].toLowerCase() === 'in'
}

export function isValidGitHubUrl(value: string): boolean {
  if (value.trim() === '') {
    return true
  }

  const url = parseHttpsUrl(value)
  return Boolean(
    url && hasSupportedHost(url, 'github.com') && hasSinglePathSegment(url),
  )
}

export function isValidPortfolioUrl(value: string): boolean {
  return value.trim() === '' || parseHttpsUrl(value) !== null
}

export function validateApplicantProfile(
  profile: ApplicantProfile,
): ProfileValidationErrors {
  const errors: ProfileValidationErrors = {}

  if (!isValidEmail(profile.email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (!isValidPhone(profile.phone)) {
    errors.phone = 'Enter a valid phone number.'
  }
  if (!isValidLinkedInUrl(profile.linkedin)) {
    errors.linkedin = 'Enter a valid LinkedIn HTTPS profile URL.'
  }
  if (!isValidGitHubUrl(profile.github)) {
    errors.github = 'Enter a valid GitHub HTTPS profile URL.'
  }
  if (!isValidPortfolioUrl(profile.portfolio)) {
    errors.portfolio = 'Enter a valid portfolio HTTPS URL.'
  }

  return errors
}

type StringProfileKey = {
  [K in keyof ApplicantProfile]: ApplicantProfile[K] extends string ? K : never
}[keyof ApplicantProfile]

export function updateProfileValue<K extends StringProfileKey>(
  state: ProfileReviewState,
  field: K,
  value: ApplicantProfile[K],
): ProfileReviewState {
  const normalizedValue = value.trim()
  if (state.values[field] === normalizedValue) {
    return state
  }

  const values = { ...state.values, [field]: normalizedValue }
  // "Full name" is not edited directly; it always follows first + last name
  // so application forms that ask for one combined name still get filled.
  if (field === 'firstName' || field === 'lastName') {
    values.fullName = joinName(values.firstName, values.lastName)
  }

  return {
    ...state,
    values,
    revision: state.revision + 1,
    confirmedRevision: null,
  }
}

export function confirmProfileReview(
  state: ProfileReviewState,
): ProfileReviewState {
  return {
    ...state,
    confirmedRevision: state.revision,
  }
}

export function isProfileReviewConfirmed(state: ProfileReviewState): boolean {
  return state.confirmedRevision === state.revision
}
