export interface ApplicantProfile {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  city: string
  state: string
  linkedin: string
  github: string
  portfolio: string
}

export interface ProfileReviewState {
  values: ApplicantProfile
  revision: number
  confirmedRevision: number | null
  sourceFilename: string
}
