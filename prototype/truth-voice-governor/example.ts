import { buildAnswerSpec } from './governor.js'
import { verifyDraft } from './verifier.js'

const spec = buildAnswerSpec({
  headline: 'Meta prospecting performance deteriorated materially.',
  claims: [
    { id: 'spend', kind: 'fact', statement: 'Spend was $8,421.', metric: 'spend', value: 8421, unit: 'CAD', sourceIds: ['meta'], confidence: 0.99, causal: false },
    { id: 'roas', kind: 'fact', statement: 'Observed ROAS was 1.33x.', metric: 'roas', value: 1.33, unit: 'x', sourceIds: ['meta'], confidence: 0.97, causal: false },
  ],
  unknowns: ['Incremental revenue has not been experimentally measured.'],
  confidence: { measurement: 0.97, causal: 0.35, completeness: 0.9, decision: 0.82 },
  proposedDecision: { state: 'keep', reason: 'Do not scale until incremental economics are established.' },
})

const result = verifyDraft(spec, {
  headline: spec.headline,
  usedClaimIds: ['spend', 'roas'],
  numericClaims: [{ claimId: 'spend', value: 8421 }, { claimId: 'roas', value: 1.33 }],
  causalClaimIds: [],
  recommendation: 'Keep spend flat while measuring incrementality.',
  acknowledgedContradictions: [],
  assertedUnknowns: [],
})

console.log(JSON.stringify({ spec, result }, null, 2))
