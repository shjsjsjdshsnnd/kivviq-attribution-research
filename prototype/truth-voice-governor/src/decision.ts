import { claimById } from './claim-ledger.js'
import type {
  Claim,
  ClaimLedger,
  Contradiction,
  Decision,
  DecisionCandidate,
} from './types.js'

const LOW_EVIDENCE_THRESHOLD = 0.55

function insufficient(target: string, reason: string, support: readonly string[] = []): Decision {
  return Object.freeze({
    state: 'INSUFFICIENT_EVIDENCE',
    target,
    reason,
    supportingClaimIds: Object.freeze([...support]),
    contradictingClaimIds: Object.freeze([]),
    confidence: 0,
    risk: 'UNKNOWN',
    reversibility: 'UNKNOWN',
    measurementRequirement: 'Collect sufficient governed evidence before making a directional recommendation.',
    conditionsThatWouldChangeDecision: Object.freeze(['Sufficient high-quality evidence becomes available.']),
  })
}

function evidenceConfidence(claims: readonly Claim[]): number {
  if (claims.length === 0) return 0
  return Math.min(...claims.map((claim) => Math.min(claim.measurementConfidence, claim.completeness)))
}

export function governDecision(
  ledger: ClaimLedger,
  contradictions: readonly Contradiction[],
  candidate?: DecisionCandidate,
): Decision {
  if (!candidate) return insufficient('unspecified', 'No evidence-backed decision candidate was supplied.')
  if (candidate.supportingClaimIds.length === 0) {
    return insufficient(candidate.target, 'A recommendation cannot exist without supporting claim IDs.')
  }

  const supportingClaims = candidate.supportingClaimIds.map((id) => claimById(ledger, id))
  if (supportingClaims.some((claim) => claim === undefined)) {
    return insufficient(candidate.target, 'A supporting claim does not exist in the governed ledger.')
  }
  const claims = supportingClaims.filter((claim): claim is Claim => claim !== undefined)
  if (claims.some((claim) => claim.type === 'UNKNOWN')) {
    return insufficient(candidate.target, 'UNKNOWN claims cannot support a directional recommendation.', candidate.supportingClaimIds)
  }

  const baseConfidence = evidenceConfidence(claims)
  if (baseConfidence < LOW_EVIDENCE_THRESHOLD) {
    return insufficient(candidate.target, 'Supporting evidence is below the minimum confidence/completeness threshold.', candidate.supportingClaimIds)
  }

  const blocking = contradictions.filter(
    (contradiction) =>
      contradiction.blocksDecision &&
      contradiction.claimIds.some((id) => candidate.supportingClaimIds.includes(id)),
  )
  if (blocking.length > 0 && candidate.state !== 'INVESTIGATE') {
    return Object.freeze({
      state: 'INVESTIGATE',
      target: candidate.target,
      reason: 'A material unresolved contradiction blocks the directional decision.',
      supportingClaimIds: Object.freeze([...candidate.supportingClaimIds]),
      contradictingClaimIds: Object.freeze([...new Set(blocking.flatMap((item) => item.claimIds))]),
      confidence: Math.max(0, baseConfidence - Math.max(...blocking.map((item) => item.confidencePenalty))),
      risk: candidate.risk,
      reversibility: candidate.reversibility,
      measurementRequirement: 'Resolve the material contradiction before changing spend or strategy.',
      conditionsThatWouldChangeDecision: Object.freeze([
        ...candidate.conditionsThatWouldChangeDecision,
        'The blocking contradiction is resolved.',
      ]),
    })
  }

  return Object.freeze({
    state: candidate.state,
    target: candidate.target,
    reason: candidate.reason,
    supportingClaimIds: Object.freeze([...candidate.supportingClaimIds]),
    contradictingClaimIds: Object.freeze([...new Set(
      contradictions
        .filter((item) => item.claimIds.some((id) => candidate.supportingClaimIds.includes(id)))
        .flatMap((item) => item.claimIds),
    )]),
    confidence: baseConfidence,
    expectedImpact: candidate.expectedImpact,
    risk: candidate.risk,
    reversibility: candidate.reversibility,
    measurementRequirement: candidate.measurementRequirement,
    conditionsThatWouldChangeDecision: Object.freeze([...candidate.conditionsThatWouldChangeDecision]),
  })
}
