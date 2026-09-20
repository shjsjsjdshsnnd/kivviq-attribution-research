import type { AnswerSpec, VerificationResult } from './types.js'

export interface DraftAnswer {
  headline: string
  usedClaimIds: string[]
  numericClaims: Array<{ claimId: string; value: number }>
  causalClaimIds: string[]
  recommendation?: string | null
  acknowledgedContradictions: string[]
  assertedUnknowns: string[]
}

export function verifyDraft(spec: AnswerSpec, draft: DraftAnswer): VerificationResult {
  const violations: string[] = []
  const claims = new Map(spec.claims.map(c => [c.id, c]))

  for (const id of draft.usedClaimIds) if (!claims.has(id)) violations.push(`unknown claim id: ${id}`)
  for (const n of draft.numericClaims) {
    const c = claims.get(n.claimId)
    if (!c || c.value !== n.value) violations.push(`numeric claim not supported: ${n.claimId}`)
  }
  for (const id of draft.causalClaimIds) {
    const c = claims.get(id)
    if (!c?.causal) violations.push(`causal language unsupported: ${id}`)
  }
  for (const u of draft.assertedUnknowns) if (spec.unknowns.includes(u)) violations.push(`unknown upgraded to assertion: ${u}`)
  for (const c of spec.contradictions) if (!draft.acknowledgedContradictions.includes(c)) violations.push(`material contradiction omitted: ${c}`)
  if (draft.recommendation && (!spec.decision || spec.decision.state === 'insufficient_evidence')) violations.push('recommendation invented or decision is blocked')

  return { ok: violations.length === 0, violations }
}
