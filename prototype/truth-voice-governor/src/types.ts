export type ClaimType =
  | 'FACT'
  | 'DERIVED_FACT'
  | 'INFERENCE'
  | 'CAUSAL_INFERENCE'
  | 'UNKNOWN'

export type LanguageStrength =
  | 'UNKNOWN_ONLY'
  | 'QUALIFIED'
  | 'SUGGESTIVE'
  | 'ASSERTIVE'
  | 'CAUSAL'

export type MaterialityState = 'IMMATERIAL' | 'WATCH' | 'MATERIAL' | 'CRITICAL' | 'UNKNOWN'
export type ContradictionStatus = 'NONE' | 'RESOLVED' | 'UNRESOLVED'
export type DecisionState = 'SCALE' | 'KEEP' | 'REDUCE' | 'STOP' | 'INVESTIGATE' | 'INSUFFICIENT_EVIDENCE'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
export type Reversibility = 'EASY' | 'MODERATE' | 'DIFFICULT' | 'UNKNOWN'
export type ConclusionPolarity = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNCERTAIN'
export type PremiseStatus = 'SUPPORTED' | 'CONTRADICTED' | 'UNRESOLVED'

export interface MetricIdentity {
  id: string
  name: string
}

export type DimensionValue = string | number | boolean
export type Dimensions = Readonly<Record<string, DimensionValue>>

export interface Period {
  start: string
  end: string
  comparison?: {
    start: string
    end: string
  }
}

export interface Measure {
  value: number
  unit: string
  currency?: string
}

export interface Provenance {
  sourceSystem: string
  evidenceType: 'DIRECT' | 'DERIVED' | 'MODELLED'
  method: string
  transformations: readonly string[]
  observedAt?: string
}

export interface ConfidenceDimensions {
  measurement: number
  causal: number
  completeness: number
}

export interface Claim {
  id: string
  type: ClaimType
  metric: MetricIdentity
  dimensions: Dimensions
  period: Period
  currentValue?: Measure
  comparisonValue?: Measure
  evidenceIds: readonly string[]
  sourceIds: readonly string[]
  provenance: Provenance
  measurementConfidence: number
  causalConfidence: number
  completeness: number
  materiality: MaterialityState
  contradictionStatus: ContradictionStatus
  allowedLanguage: LanguageStrength
  statement: string
}

export type ClaimInput = Omit<Claim, 'allowedLanguage'>

export interface ClaimLedger {
  claims: readonly Claim[]
}

export interface MerchantEconomics {
  contributionMargin?: number
  grossMargin?: number
  breakEvenRoas?: number
  cacTarget?: Measure
  ltv?: Measure
  paybackRequirementDays?: number
  cashConstraint?: {
    maxMonthlySpend?: Measure
    minCashReserve?: Measure
  }
  inventoryConstraint?: {
    constrained: boolean
    availableUnits?: number
    maxSellThroughRate?: number
  }
  growthTarget?: {
    metricId: string
    relativeChange?: number
    absoluteValue?: Measure
  }
}

export interface MaterialityPolicy {
  minSampleSize: number
  minCompleteness: number
  noiseBandAbsolute?: number
  noiseBandRelative?: number
  watchAbsolute?: number
  materialAbsolute?: number
  criticalAbsolute?: number
  watchRelative: number
  materialRelative: number
  criticalRelative: number
  watchEconomicImpact?: number
  materialEconomicImpact?: number
  criticalEconomicImpact?: number
}

export interface MaterialityInput {
  currentValue: number
  comparisonValue?: number
  sampleSize?: number
  completeness: number
  economicImpact?: number
  merchantThresholdCrossed?: boolean
}

export interface MaterialityResult {
  state: MaterialityState
  absoluteChange?: number
  relativeChange?: number
  economicImpact?: number
  reasons: readonly string[]
}

export interface Contradiction {
  id: string
  claimIds: readonly string[]
  sourceIds: readonly string[]
  absoluteDisagreement?: number
  relativeDisagreement?: number
  material: boolean
  likelyExplanation?: string
  status: Exclude<ContradictionStatus, 'NONE'>
  confidencePenalty: number
  blocksDecision: boolean
}

export interface Decision {
  state: DecisionState
  target: string
  reason: string
  supportingClaimIds: readonly string[]
  contradictingClaimIds: readonly string[]
  confidence: number
  expectedImpact?: Measure
  risk: RiskLevel
  reversibility: Reversibility
  measurementRequirement?: string
  conditionsThatWouldChangeDecision: readonly string[]
}

export interface DecisionCandidate {
  state: Exclude<DecisionState, 'INSUFFICIENT_EVIDENCE'>
  target: string
  reason: string
  supportingClaimIds: readonly string[]
  expectedImpact?: Measure
  risk: RiskLevel
  reversibility: Reversibility
  measurementRequirement?: string
  conditionsThatWouldChangeDecision: readonly string[]
}

export interface UserPremise {
  text: string
  status: PremiseStatus
  correctingClaimIds?: readonly string[]
}

export interface ResponseContract {
  conclusionFirst: true
  strongestSupportedWordingOnly: true
  numbersWhenRelevant: true
  explicitUnknowns: true
  explicitMaterialContradictions: true
  noUnsupportedOptimism: true
  noUnnecessaryHedging: true
  noGenericConsultantLanguage: true
  noInventedRecommendations: true
  noFabricatedCausality: true
  missingIsNotZero: true
  attributionIsNotIncrementality: true
  uncertaintyNotFootnoted: true
  challengeFalsePremise: true
}

export interface AnswerSpec {
  version: 'truth-voice-governor/v1'
  question: string
  conclusion: {
    decisionState: DecisionState
    target: string
    polarity: ConclusionPolarity
    claimIds: readonly string[]
  }
  claimLedger: ClaimLedger
  materiality: readonly MaterialityResult[]
  contradictions: readonly Contradiction[]
  decision: Decision
  merchantEconomics: MerchantEconomics
  unknownClaimIds: readonly string[]
  requiredContradictionIds: readonly string[]
  requiredDisclosureIds: readonly string[]
  userPremise?: UserPremise
  responseContract: ResponseContract
}

export interface DraftAnswer {
  text: string
  usedClaimIds: readonly string[]
  claimLanguage: readonly {
    claimId: string
    strength: LanguageStrength
  }[]
  numericMentions: readonly {
    value: number
    claimId?: string
  }[]
  sourceAttributions: readonly {
    claimId: string
    sourceId: string
  }[]
  acknowledgedContradictionIds: readonly string[]
  acknowledgedUnknownClaimIds: readonly string[]
  acknowledgedDisclosureIds: readonly string[]
  recommendation?: {
    state: DecisionState
    target: string
  }
  merchantThresholdMentions: readonly {
    key: keyof MerchantEconomics
    value: number
  }[]
  premiseCorrected?: boolean
}

export type ViolationCode =
  | 'FABRICATED_NUMBER'
  | 'ALTERED_NUMBER'
  | 'UNSUPPORTED_CLAIM'
  | 'UNSUPPORTED_CAUSAL_LANGUAGE'
  | 'UNKNOWN_AS_ASSERTION'
  | 'MATERIAL_CONTRADICTION_OMITTED'
  | 'UNAUTHORIZED_RECOMMENDATION'
  | 'LANGUAGE_STRENGTH_EXCEEDED'
  | 'INCORRECT_SOURCE_ATTRIBUTION'
  | 'UNSUPPORTED_MERCHANT_THRESHOLD'
  | 'POSITIVE_SPIN_CONTRADICTS_CONCLUSION'
  | 'EXCESSIVE_HEDGING'
  | 'LOW_CONFIDENCE_HIDDEN'
  | 'REQUIRED_UNKNOWN_OMITTED'
  | 'FALSE_PREMISE_NOT_CORRECTED'

export interface VerificationViolation {
  code: ViolationCode
  message: string
  claimId?: string
  contradictionId?: string
}

export interface VerificationResult {
  status: 'PASS' | 'FAIL'
  violations: readonly VerificationViolation[]
}
