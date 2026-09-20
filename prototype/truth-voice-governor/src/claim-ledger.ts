import type {
  Claim,
  ClaimInput,
  ClaimLedger,
  LanguageStrength,
} from './types.js'
import { assertClaimInput } from './validation.js'

export interface EpistemicPolicy {
  assertiveMeasurementThreshold: number
  assertiveCompletenessThreshold: number
  causalConfidenceThreshold: number
  causalMeasurementThreshold: number
  causalCompletenessThreshold: number
}

export const DEFAULT_EPISTEMIC_POLICY: EpistemicPolicy = {
  assertiveMeasurementThreshold: 0.8,
  assertiveCompletenessThreshold: 0.7,
  causalConfidenceThreshold: 0.8,
  causalMeasurementThreshold: 0.8,
  causalCompletenessThreshold: 0.7,
}

export function allowedLanguageFor(
  claim: ClaimInput,
  policy: EpistemicPolicy = DEFAULT_EPISTEMIC_POLICY,
): LanguageStrength {
  switch (claim.type) {
    case 'UNKNOWN':
      return 'UNKNOWN_ONLY'
    case 'INFERENCE':
      return 'SUGGESTIVE'
    case 'CAUSAL_INFERENCE':
      if (
        claim.causalConfidence >= policy.causalConfidenceThreshold &&
        claim.measurementConfidence >= policy.causalMeasurementThreshold &&
        claim.completeness >= policy.causalCompletenessThreshold
      ) {
        return 'CAUSAL'
      }
      return 'SUGGESTIVE'
    case 'FACT':
    case 'DERIVED_FACT':
      if (
        claim.measurementConfidence >= policy.assertiveMeasurementThreshold &&
        claim.completeness >= policy.assertiveCompletenessThreshold
      ) {
        return 'ASSERTIVE'
      }
      return 'QUALIFIED'
  }
}

export function buildClaimLedger(
  inputs: readonly ClaimInput[],
  policy: EpistemicPolicy = DEFAULT_EPISTEMIC_POLICY,
): ClaimLedger {
  const seen = new Set<string>()
  const claims: Claim[] = inputs.map((input) => {
    assertClaimInput(input)
    if (seen.has(input.id)) throw new Error('duplicate claim id: ' + input.id)
    seen.add(input.id)
    return Object.freeze({
      ...input,
      dimensions: Object.freeze({ ...input.dimensions }),
      evidenceIds: Object.freeze([...input.evidenceIds]),
      sourceIds: Object.freeze([...input.sourceIds]),
      provenance: Object.freeze({
        ...input.provenance,
        transformations: Object.freeze([...input.provenance.transformations]),
      }),
      allowedLanguage: allowedLanguageFor(input, policy),
    })
  })
  return Object.freeze({ claims: Object.freeze(claims) })
}

export function claimById(ledger: ClaimLedger, id: string): Claim | undefined {
  return ledger.claims.find((claim) => claim.id === id)
}

export const LANGUAGE_RANK: Readonly<Record<LanguageStrength, number>> = Object.freeze({
  UNKNOWN_ONLY: 0,
  QUALIFIED: 1,
  SUGGESTIVE: 2,
  ASSERTIVE: 3,
  CAUSAL: 4,
})
