import type { AnswerSpec, Claim, ConfidenceDimensions, DecisionState } from './types.js'

export interface GovernorInput {
  headline: string
  claims: Claim[]
  contradictions?: string[]
  unknowns?: string[]
  confidence: ConfidenceDimensions
  proposedDecision?: { state: DecisionState; reason: string } | null
}

export function buildAnswerSpec(input: GovernorInput): AnswerSpec {
  const contradictions = input.contradictions ?? []
  const unknowns = input.unknowns ?? []
  const decisionBlocked = input.confidence.decision < 0.6 || contradictions.length > 0
  const decision = decisionBlocked
    ? { state: 'insufficient_evidence' as const, reason: contradictions[0] ?? unknowns[0] ?? 'Decision confidence is below threshold.' }
    : input.proposedDecision ?? null

  return {
    headline: input.headline,
    claims: input.claims,
    contradictions,
    unknowns,
    decision,
    confidence: input.confidence,
    responseContract: {
      conclusionFirst: true,
      noUnsupportedPositiveSpin: true,
      noUnjustifiedHedging: true,
      stateUnknowns: true,
      surfaceMaterialContradictions: true,
      neverUpgradeUnknownToAssertion: true,
      neverInventRecommendation: true,
    },
  }
}
