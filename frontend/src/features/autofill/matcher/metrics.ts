import type { ApplicantProfile } from '../core/types'
import type { FieldDecision, FieldOutcome } from './types'

export interface ExpectedFieldOutcome {
  fieldId: string
  outcome: FieldOutcome
  profileKey?: keyof ApplicantProfile
}

export interface MatcherMetrics {
  matchingCorrectness: {
    correctProposedMappings: number
    proposedMappings: number
    rate: number | null
  }
  supportedFieldCoverage: {
    correctProposedFills: number
    eligibleSupportedEmptyFields: number
    rate: number | null
  }
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

export function calculateMatcherMetrics(
  decisions: FieldDecision[],
  expected: ExpectedFieldOutcome[],
): MatcherMetrics {
  const expectedById = new Map(expected.map((item) => [item.fieldId, item]))
  const proposedFills = decisions.filter((decision) => decision.outcome === 'fill')
  const correctProposedMappings = proposedFills.filter((decision) => {
    const truth = expectedById.get(decision.element.id)
    return truth?.outcome === 'fill' && truth.profileKey === decision.profileKey
  }).length
  const eligibleSupportedEmptyFields = expected.filter(
    (item) => item.outcome === 'fill',
  ).length

  return {
    matchingCorrectness: {
      correctProposedMappings,
      proposedMappings: proposedFills.length,
      rate: rate(correctProposedMappings, proposedFills.length),
    },
    supportedFieldCoverage: {
      correctProposedFills: correctProposedMappings,
      eligibleSupportedEmptyFields,
      rate: rate(correctProposedMappings, eligibleSupportedEmptyFields),
    },
  }
}
