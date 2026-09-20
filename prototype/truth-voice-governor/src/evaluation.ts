import type { AnswerSpec, DraftAnswer, VerificationResult, ViolationCode } from './types.js'
import { verifyDraft } from './verifier.js'

export type EvaluationCategory =
  | 'unsupported_claim'
  | 'numeric_hallucination'
  | 'causal_overstatement'
  | 'contradiction_omission'
  | 'recommendation_integrity'
  | 'unknown_preservation'
  | 'valid_answer'

export interface EvaluationCase {
  id: string
  category: EvaluationCategory
  spec: AnswerSpec
  draft: DraftAnswer
  expectedViolation?: ViolationCode
}

export interface EvaluationMetrics {
  unsupportedClaimDetectionRate: number
  numericHallucinationDetectionRate: number
  causalOverstatementDetectionRate: number
  contradictionOmissionDetectionRate: number
  recommendationIntegrityRate: number
  unknownPreservationRate: number
  falsePositiveRejectionRate: number
  overallMutationRejectionRate: number
  caseCount: number
}

function rate(cases: readonly EvaluationCase[], results: readonly VerificationResult[], category: EvaluationCategory): number {
  const indices = cases
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.category === category)
  if (indices.length === 0) return 1
  return indices.filter(({ item, index }) => {
    const result = results[index]
    return result?.status === 'FAIL' &&
      (item.expectedViolation === undefined || result.violations.some((entry) => entry.code === item.expectedViolation))
  }).length / indices.length
}

export function runEvaluation(cases: readonly EvaluationCase[]): EvaluationMetrics {
  const results = cases.map((item) => verifyDraft(item.spec, item.draft))
  const mutations = cases
    .map((item, index) => ({ item, result: results[index] }))
    .filter(({ item }) => item.category !== 'valid_answer')
  const valid = cases
    .map((item, index) => ({ item, result: results[index] }))
    .filter(({ item }) => item.category === 'valid_answer')

  return {
    unsupportedClaimDetectionRate: rate(cases, results, 'unsupported_claim'),
    numericHallucinationDetectionRate: rate(cases, results, 'numeric_hallucination'),
    causalOverstatementDetectionRate: rate(cases, results, 'causal_overstatement'),
    contradictionOmissionDetectionRate: rate(cases, results, 'contradiction_omission'),
    recommendationIntegrityRate: rate(cases, results, 'recommendation_integrity'),
    unknownPreservationRate: rate(cases, results, 'unknown_preservation'),
    falsePositiveRejectionRate:
      valid.length === 0 ? 0 : valid.filter(({ result }) => result?.status === 'FAIL').length / valid.length,
    overallMutationRejectionRate:
      mutations.length === 0 ? 1 : mutations.filter(({ result }) => result?.status === 'FAIL').length / mutations.length,
    caseCount: cases.length,
  }
}
