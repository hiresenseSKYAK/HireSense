export interface Job {
  id: number
  title: string
  company: string
  location: string
  type: string
  salary: string | number
  tags: string[]
  posted: string | null
  datePosted?: string | null
  firstSeenAt?: string | null
  source?: string | null
  badge: string | null
  match: number
  logo: string
  companyLogoUrl?: string | null
  hybrid: 'Remote' | 'Hybrid' | 'On-site'
  description?: string | JobDescription
  fullDescription?: string
  experienceLevel?: string
  salaryRange?: string | number
  dateRange?: string | null
  applicationLink?: string
  matchDetails?: {
    matchScore: number
    matchedSkills: string[]
    missingSkills: string[]
    recommendation: string
  }
}

export interface JobDescription {
  about: string
  responsibilities: string[]
  requirements: string[]
  benefits: string[]
}

export interface MarketStat {
  label: string
  value: string
  highlight?: boolean
}

export interface SkillTrend {
  name: string
  type: 'hot' | 'rising' | 'normal'
}

export interface LocationStat {
  city: string
  count: number
  pct: number
}

export interface CompanyStat {
  name: string
  openRoles: number
}

export interface ResumeSkill {
  name: string
  score: number
  color: string
}

export interface ResumeInsight {
  type: 'pos' | 'neg' | 'tip'
  text: string
}

export interface FilterOption {
  label: string
  value: string
}

export interface User {
  id: number
  username: string
  email: string
  joined_at: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
}
