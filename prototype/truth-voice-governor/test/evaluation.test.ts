import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADVERSARIAL_FIXTURES,
  makeValidDraft,
  materializeFixture,
  runEvaluation,
  withAlteredNumber,
  withCausalEscalation,
  withRecommendation,
  withUnknownAssertion,
  withUnsupportedClaim,
  withoutContradiction,
  withoutUnknown,
  type EvaluationCase,
} from '../src/index.js'

test('mutation evaluation harness rejects governed-boundary violations and preserves valid answers', () => {
  const contradictionSpec = materializeFixture(ADVERSARIAL_FIXTURES[0]!)
  const contradictionValid = makeValidDraft(contradictionSpec)
  const correlationSpec = materializeFixture(ADVERSARIAL_FIXTURES[8]!)
  const correlationValid = makeValidDraft(correlationSpec)
  const unknownSpec = materializeFixture(ADVERSARIAL_FIXTURES[4]!)
  const unknownValid = makeValidDraft(unknownSpec)
  const decisionSpec = materializeFixture(ADVERSARIAL_FIXTURES[2]!)
  const decisionValid = makeValidDraft(decisionSpec)
  const numberSpec = materializeFixture(ADVERSARIAL_FIXTURES[10]!)
  const numberValid = makeValidDraft(numberSpec)

  const secondContradictionSpec = materializeFixture(ADVERSARIAL_FIXTURES[7]!)
  const secondContradictionValid = makeValidDraft(secondContradictionSpec)
  const insufficientSpec = materializeFixture(ADVERSARIAL_FIXTURES[12]!)
  const insufficientValid = makeValidDraft(insufficientSpec)

  const cases: EvaluationCase[] = [
    {
      id: 'unsupported-claim-id',
      category: 'unsupported_claim',
      spec: decisionSpec,
      draft: withUnsupportedClaim(decisionValid, 'fabricated-claim'),
      expectedViolation: 'UNSUPPORTED_CLAIM',
    },
    {
      id: 'unsupported-language-claim-id',
      category: 'unsupported_claim',
      spec: decisionSpec,
      draft: { ...decisionValid, claimLanguage: [...decisionValid.claimLanguage, { claimId: 'fabricated-claim', strength: 'ASSERTIVE' }] },
      expectedViolation: 'UNSUPPORTED_CLAIM',
    },
    {
      id: 'fabricated-number',
      category: 'numeric_hallucination',
      spec: numberSpec,
      draft: { ...numberValid, text: 'Observed ROAS was 8.912x.' },
      expectedViolation: 'FABRICATED_NUMBER',
    },
    {
      id: 'altered-number',
      category: 'numeric_hallucination',
      spec: numberSpec,
      draft: withAlteredNumber(numberValid, 'roas', 8.912, 'Observed ROAS was 8.912x.'),
      expectedViolation: 'ALTERED_NUMBER',
    },
    {
      id: 'causal-text-overstatement',
      category: 'causal_overstatement',
      spec: correlationSpec,
      draft: { ...correlationValid, text: 'Higher spend caused higher revenue.' },
      expectedViolation: 'UNSUPPORTED_CAUSAL_LANGUAGE',
    },
    {
      id: 'causal-language-escalation',
      category: 'causal_overstatement',
      spec: correlationSpec,
      draft: withCausalEscalation(correlationValid, 'correlation', 'Higher spend caused higher revenue.'),
      expectedViolation: 'UNSUPPORTED_CAUSAL_LANGUAGE',
    },
    {
      id: 'contradiction-omission-meta-shopify',
      category: 'contradiction_omission',
      spec: contradictionSpec,
      draft: withoutContradiction(contradictionValid, 'revenue-source-disagreement'),
      expectedViolation: 'MATERIAL_CONTRADICTION_OMITTED',
    },
    {
      id: 'contradiction-omission-order-sources',
      category: 'contradiction_omission',
      spec: secondContradictionSpec,
      draft: withoutContradiction(secondContradictionValid, 'order-conflict'),
      expectedViolation: 'MATERIAL_CONTRADICTION_OMITTED',
    },
    {
      id: 'wrong-directional-recommendation',
      category: 'recommendation_integrity',
      spec: decisionSpec,
      draft: withRecommendation(decisionValid, 'SCALE', decisionSpec.decision.target),
      expectedViolation: 'UNAUTHORIZED_RECOMMENDATION',
    },
    {
      id: 'recommendation-with-insufficient-evidence',
      category: 'recommendation_integrity',
      spec: insufficientSpec,
      draft: withRecommendation(insufficientValid, 'SCALE', 'campaign'),
      expectedViolation: 'UNAUTHORIZED_RECOMMENDATION',
    },
    {
      id: 'unknown-omitted',
      category: 'unknown_preservation',
      spec: unknownSpec,
      draft: withoutUnknown(unknownValid, 'revenue-unknown'),
      expectedViolation: 'REQUIRED_UNKNOWN_OMITTED',
    },
    {
      id: 'unknown-promoted-to-fact',
      category: 'unknown_preservation',
      spec: unknownSpec,
      draft: withUnknownAssertion(unknownValid, 'revenue-unknown'),
      expectedViolation: 'UNKNOWN_AS_ASSERTION',
    },
    ...ADVERSARIAL_FIXTURES.map((fixture) => {
      const spec = materializeFixture(fixture)
      return {
        id: 'valid-' + fixture.id,
        category: 'valid_answer' as const,
        spec,
        draft: makeValidDraft(spec),
      }
    }),
  ]

  const metrics = runEvaluation(cases)
  assert.equal(metrics.caseCount, 25)
  assert.equal(metrics.unsupportedClaimDetectionRate, 1)
  assert.equal(metrics.numericHallucinationDetectionRate, 1)
  assert.equal(metrics.causalOverstatementDetectionRate, 1)
  assert.equal(metrics.contradictionOmissionDetectionRate, 1)
  assert.equal(metrics.recommendationIntegrityRate, 1)
  assert.equal(metrics.unknownPreservationRate, 1)
  assert.equal(metrics.falsePositiveRejectionRate, 0)
  assert.equal(metrics.overallMutationRejectionRate, 1)
})
