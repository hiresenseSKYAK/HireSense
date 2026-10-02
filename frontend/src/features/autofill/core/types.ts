export interface EducationEntry {
  school: string
  degree: string
  fieldOfStudy: string
  startDate: string
  endDate: string
  current: boolean
}

export interface ExperienceEntry {
  company: string
  title: string
  location: string
  startDate: string
  endDate: string
  description: string
  current: boolean
}

export interface ApplicantProfile {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  state: string
  country: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  linkedin: string
  github: string
  portfolio: string
  skills: string
  skillList: string[]
  school: string
  degree: string
  fieldOfStudy: string
  educationStart: string
  educationEnd: string
  company: string
  jobTitle: string
  workLocation: string
  employmentStart: string
  employmentEnd: string
  education: EducationEntry[]
  experience: ExperienceEntry[]
}

export interface ProfileReviewState {
  values: ApplicantProfile
  revision: number
  confirmedRevision: number | null
  sourceFilename: string
}
