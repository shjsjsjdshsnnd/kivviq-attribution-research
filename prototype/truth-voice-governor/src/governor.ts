import { governEvidence, type EvidenceRequest, type GovernedFact } from './evidence.js'
import { claimById } from './claim-ledger.js'
import type {
  AnswerSpec,
  ClaimLedger,
  Contradiction,
  Decision,
  MaterialityResult,
  MerchantEconomics,
  ResponseContract,
  UserPremise,
} from './types.js'

const RESPONSE_CONTRACT: ResponseContract = Object.freeze({
  conclusionFirst: true,
  strongestSupportedWordingOnly: true,
  numbersWhenRelevant: true,
  explicitUnknowns: true,
  explicitMaterialContradictions: true,
  noUnsupportedOptimism: true,
  noUnnecessaryHedging: true,
  noGenericConsultantLanguage: true,
  noInventedRecommendations: true,
  noFabricatedCausality: true,
  missingIsNotZero: true,
  attributionIsNotIncrementality: true,
  uncertaintyNotFootnoted: true,
  challengeFalsePremise: true,
})

function polarityForDecision(state: Decision['state']): AnswerSpec['conclusion']['polarity'] {
  switch (state) {
    case 'SCALE':
      return 'POSITIVE'
    case 'REDUCE':
    case 'STOP':
      return 'NEGATIVE'
    case 'KEEP':
      return 'NEUTRAL'
    case 'INVESTIGATE':
    case 'INSUFFICIENT_EVIDENCE':
      return 'UNCERTAIN'
  }
}

export interface GovernorInput {
  question: string
  evidenceRequest?: EvidenceRequest
  evidence?: readonly GovernedFact[]
  claimLedger: ClaimLedger
  materiality: readonly MaterialityResult[]
  contradictions: readonly Contradiction[]
  decision: Decision
  merchantEconomics: MerchantEconomics
  conclusionClaimIds: readonly string[]
  userPremise?: UserPremise
}

export function buildAnswerSpec(input: GovernorInput): AnswerSpec {
  if (input.evidenceRequest) {
    const governed = governEvidence(input.evidenceRequest, input.evidence ?? [])
    if (governed.primary.length === 0 && input.conclusionClaimIds.length) throw new Error('no semantically compatible primary evidence')
  }
  for (const id of input.conclusionClaimIds) {
    if (!claimById(input.claimLedger, id)) throw new Error('conclusion references missing claim: ' + id)
  }

  const unknownClaimIds = input.claimLedger.claims
    .filter((claim) => claim.type === 'UNKNOWN')
    .map((claim) => claim.id)
  const requiredContradictionIds = input.contradictions
    .filter((contradiction) => contradiction.material && contradiction.status === 'UNRESOLVED')
    .map((contradiction) => contradiction.id)

  const requiredDisclosureIds: string[] = [
    ...unknownClaimIds.map((id) => 'UNKNOWN:' + id),
    ...requiredContradictionIds.map((id) => 'CONTRADICTION:' + id),
  ]
  if (input.decision.confidence < 0.7) requiredDisclosureIds.push('LOW_CONFIDENCE')
  if (input.userPremise?.status === 'CONTRADICTED') requiredDisclosureIds.push('FALSE_PREMISE')

  return Object.freeze({
    version: 'truth-voice-governor/v1',
    question: input.question,
    evidenceRequest: input.evidenceRequest,
    evidence: input.evidence ? Object.freeze([...input.evidence]) : undefined,
    conclusion: Object.freeze({
      decisionState: input.decision.state,
      target: input.decision.target,
      polarity: polarityForDecision(input.decision.state),
      claimIds: Object.freeze([...input.conclusionClaimIds]),
    }),
    claimLedger: input.claimLedger,
    materiality: Object.freeze([...input.materiality]),
    contradictions: Object.freeze([...input.contradictions]),
    decision: input.decision,
    merchantEconomics: input.merchantEconomics,
    unknownClaimIds: Object.freeze(unknownClaimIds),
    requiredContradictionIds: Object.freeze(requiredContradictionIds),
    requiredDisclosureIds: Object.freeze(requiredDisclosureIds),
    userPremise: input.userPremise,
    responseContract: RESPONSE_CONTRACT,
  })
}
