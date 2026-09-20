export type ClaimKind = 'fact' | 'inference' | 'unknown'
export type DecisionState = 'scale' | 'keep' | 'reduce' | 'stop' | 'investigate' | 'insufficient_evidence'

export interface Claim {
  id: string
  kind: ClaimKind
  statement: string
  metric?: string
  value?: number
  unit?: string
  sourceIds: string[]
  confidence: number
  causal: boolean
}

export interface ConfidenceDimensions {
  measurement: number
  causal: number
  completeness: number
  decision: number
}

export interface AnswerSpec {
  headline: string
  claims: Claim[]
  contradictions: string[]
  unknowns: string[]
  decision: { state: DecisionState; reason: string } | null
  confidence: ConfidenceDimensions
  responseContract: {
    conclusionFirst: true
    noUnsupportedPositiveSpin: true
    noUnjustifiedHedging: true
    stateUnknowns: true
    surfaceMaterialContradictions: true
    neverUpgradeUnknownToAssertion: true
    neverInventRecommendation: true
  }
}

export interface VerificationResult {
  ok: boolean
  violations: string[]
}
