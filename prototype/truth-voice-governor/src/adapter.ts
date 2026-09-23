import type { AnswerSpec } from './types.js'

export type LlmClientKind = 'generic' | 'chatgpt-mcp' | 'claude'

export interface LlmPayload {
  protocol: 'kivviq-answer-spec/v1'
  instruction: string
  payload: string
}

export function serializeAnswerSpec(
  spec: AnswerSpec,
  client: LlmClientKind = 'generic',
): LlmPayload {
  const compact = {
    v: spec.version,
    q: spec.question,
    er: spec.evidenceRequest,
    ev: spec.evidence,
    c: spec.conclusion,
    cl: spec.claimLedger.claims.map((claim) => ({
      id: claim.id,
      t: claim.type,
      m: claim.metric.id,
      d: claim.dimensions,
      p: claim.period,
      v: claim.currentValue,
      cv: claim.comparisonValue,
      s: claim.sourceIds,
      mc: claim.measurementConfidence,
      cc: claim.causalConfidence,
      co: claim.completeness,
      mat: claim.materiality,
      con: claim.contradictionStatus,
      lang: claim.allowedLanguage,
      st: claim.statement,
    })),
    x: spec.contradictions,
    d: spec.decision,
    e: spec.merchantEconomics,
    u: spec.unknownClaimIds,
    rx: spec.requiredContradictionIds,
    rd: spec.requiredDisclosureIds,
    up: spec.userPremise,
    r: spec.responseContract,
  }

  return Object.freeze({
    protocol: 'kivviq-answer-spec/v1',
    instruction:
      'Write direct prose from this governed spec. Do not add facts, numbers, thresholds, causality, recommendations, or certainty beyond the payload. Return a structured DraftAnswer envelope for verification before user delivery. Client=' + client + '.',
    payload: JSON.stringify(compact),
  })
}
