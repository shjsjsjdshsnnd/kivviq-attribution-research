import { claimById } from './claim-ledger.js'
import type { ClaimLedger, Contradiction } from './types.js'

export interface ContradictionPolicy {
  materialAbsoluteDisagreement: number
  materialRelativeDisagreement: number
  confidencePenalty: number
}

export const DEFAULT_CONTRADICTION_POLICY: ContradictionPolicy = {
  materialAbsoluteDisagreement: 100,
  materialRelativeDisagreement: 0.1,
  confidencePenalty: 0.25,
}

export interface ContradictionInput {
  id: string
  claimIds: readonly [string, string]
  likelyExplanation?: string
  resolved?: boolean
}

export function buildContradiction(
  ledger: ClaimLedger,
  input: ContradictionInput,
  policy: ContradictionPolicy = DEFAULT_CONTRADICTION_POLICY,
): Contradiction {
  const left = claimById(ledger, input.claimIds[0])
  const right = claimById(ledger, input.claimIds[1])
  if (!left || !right) throw new Error('contradiction references missing claim')
  if (left.metric.id !== right.metric.id) throw new Error('contradicting claims must share metric identity')

  const leftValue = left.currentValue?.value
  const rightValue = right.currentValue?.value
  const absoluteDisagreement =
    leftValue === undefined || rightValue === undefined ? undefined : Math.abs(leftValue - rightValue)
  const denominator =
    leftValue === undefined || rightValue === undefined ? undefined : Math.max(Math.abs(leftValue), Math.abs(rightValue))
  const relativeDisagreement =
    absoluteDisagreement === undefined || denominator === undefined || denominator === 0
      ? undefined
      : absoluteDisagreement / denominator

  const material =
    (absoluteDisagreement !== undefined && absoluteDisagreement >= policy.materialAbsoluteDisagreement) ||
    (relativeDisagreement !== undefined && relativeDisagreement >= policy.materialRelativeDisagreement)
  const status = input.resolved ? 'RESOLVED' as const : 'UNRESOLVED' as const
  const sourceIds = Object.freeze([...new Set([...left.sourceIds, ...right.sourceIds])])

  return Object.freeze({
    id: input.id,
    claimIds: Object.freeze([...input.claimIds]),
    sourceIds,
    absoluteDisagreement,
    relativeDisagreement,
    material,
    likelyExplanation: input.likelyExplanation,
    status,
    confidencePenalty: material && status === 'UNRESOLVED' ? policy.confidencePenalty : 0,
    blocksDecision: material && status === 'UNRESOLVED',
  })
}
