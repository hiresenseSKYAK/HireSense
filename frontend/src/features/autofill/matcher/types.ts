import type { ApplicantProfile } from '../core/types'

export type ApplicationControl =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement

export type FieldOutcome =
  | 'fill'
  | 'preserve'
  | 'missing'
  | 'ambiguous'
  | 'unsupported'
  | 'sensitive'
  | 'invalid'

export type EvidenceSource =
  | 'autocomplete'
  | 'label'
  | 'accessibility label'
  | 'name'
  | 'id'
  | 'placeholder'
  | 'section context'
  | 'input type'

export interface MatchEvidence {
  source: EvidenceSource
  text: string
  profileKey?: keyof ApplicantProfile
}

export interface FieldDecision {
  element: ApplicationControl
  outcome: FieldOutcome
  reason: string
  profileKey?: keyof ApplicantProfile
  value?: string
  evidence: MatchEvidence[]
}

export interface FillResult {
  decisions: FieldDecision[]
  filled: number
  preserved: number
  needsInput: number
  skipped: number
  verificationFailures: number
}
